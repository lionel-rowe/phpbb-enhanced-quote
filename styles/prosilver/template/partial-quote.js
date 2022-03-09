;(() => {
	// common

	const isQuoteUrl = (url) =>
		url.pathname.endsWith('/posting.php') &&
		url.searchParams.get('mode') === 'quote'

	const logPerf =
		(fn) =>
		(...args) => {
			console.time(fn.name)
			const result = fn(...args)
			console.timeEnd(fn.name)

			return result
		}

	const matchRichTextFromPlain = logPerf(function matchRichTextFromPlain(
		richText,
		plainFragment,
	) {
		try {
			// [b], [/b], [url=...], [tag attr=...]
			const _bbCodeTag = /\[[^\]\n]+\](?!\()/u.source
			// ](https://example.com), latter half of [text](https://example.com) or ![alt](https://example.com/img.jpg)
			const _mdUrl = /\]\([^\)]+\)/u.source
			const _nonAlphaNum = /[^\p{L}\p{N}]/u.source

			const ignorer = new RegExp(
				`(?:${_bbCodeTag}|${_mdUrl}|${_nonAlphaNum})+`,
				'gu',
			)
			const _bbCodeTagOrPunctuation = new RegExp(
				String.raw`(?:${_bbCodeTag}|\p{P})*`,
				'gu',
			).source

			const richTextMatcher = new RegExp(
				[
					_bbCodeTagOrPunctuation,
					plainFragment.replace(ignorer, ignorer.source),
					_bbCodeTagOrPunctuation,
				].join(''),
				'u',
			)

			const matchData = richText.match(richTextMatcher)

			let matched = matchData?.[0]?.trim()

			if (!matched) {
				return plainFragment
			}

			const index = matchData.index
			const endIndex = index + matchData[0].length

			const textBefore = richText.slice(0, index)
			const textAfter = richText.slice(endIndex)

			const bbCodeTagMatcher = new RegExp(_bbCodeTag, 'gu')

			// fix orphan BBCode tags
			const tagsWithin = matched.match(bbCodeTagMatcher) ?? []

			const tagsBefore = (
				textBefore.match(bbCodeTagMatcher) ?? []
			).reverse()
			const tagsAfter = textAfter.match(bbCodeTagMatcher) ?? []

			const isEndTag = (tag) => tag[1] === '/'
			const isStartTag = (tag) => !isEndTag(tag)
			const getStartTagName = (tag) => tag.slice(1).match(/^\w+/)?.[0]
			const getEndTagName = (tag) => tag.slice(2, -1)

			const tagsMatch = (tag1, tag2) => {
				const tags = [tag1, tag2]

				const startTag = tags.find(isStartTag)
				const endTag = tags.find(isEndTag)

				return (
					startTag &&
					endTag &&
					getStartTagName(startTag) === getEndTagName(endTag)
				)
			}

			// orphan end-tags at start
			for (const tag of tagsWithin) {
				if (isEndTag(tag) && tagsMatch(tag, tagsBefore[0])) {
					matched = tagsBefore.shift() + matched
				} else {
					break
				}
			}

			// orphan start-tags at end
			for (const tag of [...tagsWithin].reverse()) {
				if (isStartTag(tag) && tagsMatch(tag, tagsAfter[0])) {
					matched += tagsAfter.shift()
				} else {
					break
				}
			}

			// enclosing tags not included in selection
			for (const [idx, tag] of tagsBefore.entries()) {
				if (isStartTag(tag) && tagsMatch(tag, tagsAfter[idx])) {
					matched = tag + matched + tagsAfter[idx]
				} else {
					break
				}
			}

			// partial md link
			if (matched.endsWith('](')) {
				matched += textAfter.match(/^[^)]+\)/)?.[0] ?? ''
			}

			const _mdChars = /[\s*#\d.`\-+~]/u.source

			const trailingMd = new RegExp(`${_mdChars}+$`, 'u')

			const trailingMdOnOwnLine = new RegExp(`\n${_mdChars}+$`, 'u')
			const leadingMdOnOwnLine = new RegExp(`^${_mdChars}+\n`, 'u')

			// fix missing markdown headings/bullets/etc. at start
			const trailingPunctuation = (
				textBefore.split('\n').slice(-1)?.[0] ?? ''
			).match(trailingMd)?.[0]

			if (trailingPunctuation) {
				matched = trailingPunctuation + matched
			}

			return matched
				.replace(trailingMdOnOwnLine, '')
				.replace(leadingMdOnOwnLine, '')
				.trim()
		} catch (e) {
			console.error(e)

			return plainFragment.trim()
		}
	})

	// source page (e.g. topic view page)

	const checkAllSameParentPost = (nodes) => {
		const parentPosts = nodes.map((node) =>
			node.parentElement.closest('.post'),
		)

		return parentPosts.every(Boolean) && new Set(parentPosts).size === 1
	}

	const checkSelectionForQuoteBtn = ({ anchorNode, focusNode }, quoteBtn) =>
		anchorNode &&
		focusNode &&
		checkAllSameParentPost([quoteBtn, anchorNode, focusNode])

	const selector = '.post-buttons a[href]'

	const attrsForLinks = new WeakMap()

	for (const eventType of ['mouseover', 'click']) {
		document.body.addEventListener(eventType, (e) => {
			const link = e.target.closest(selector)

			if (link) {
				const url = new URL(link.href)
				const selection = window.getSelection()

				const selectedText = selection.toString()

				if (isQuoteUrl(url)) {
					const samePageQuoteHandler = link.getAttribute('onclick')
					const cached = attrsForLinks.get(link)

					if (cached || samePageQuoteHandler) {
						if (!cached) {
							const paramStr = samePageQuoteHandler.match(
								/^\s*addquote\((.+)\)\s*$/,
							)?.[1]

							// `paramStr` is trusted as safe JS code due to coming from an existing
							// `onclick` function that is generated by phpBB;
							// we intercept the params before they are passed to `addquote`,
							// and instead selectively pass them to `generateQuote`
							// eslint-disable-next-line no-eval
							const [_postId, author, _wrote, attrs] = eval(
								`[${paramStr}]`,
							)

							if (author && attrs) {
								attrsForLinks.set(link, { ...attrs, author })
								link.removeAttribute('onclick')
							} else {
								return
							}
						}

						if (e.type === 'click') {
							const attrs = attrsForLinks.get(link)

							const $richText = document.querySelector(
								`#message_${attrs.post_id}`,
							)

							const display = $richText.style.display

							$richText.style.display = 'block' // ensure proper newline rendering
							const richText = $richText.innerText // not textContent
							$richText.style.display = display // revert

							const content = selectedText.trim()
								? matchRichTextFromPlain(richText, selectedText)
								: richText

							window.insert_text(
								window.generateQuote(content, attrs),
							)
						}
					} else {
						if (
							checkSelectionForQuoteBtn(selection, link) &&
							selectedText
						) {
							url.searchParams.set('selected-text', selectedText)
						} else {
							url.searchParams.delete('selected-text')
						}

						link.href = url.href
					}
				}
			}
		})
	}

	// target page (/posting.php?mode=quote...)

	const quoteMatcher = /^(\s*\[quote[^\]]*\])([\s\S]+)(\[\/quote\]\s*)$/u

	const quoteToPartial = (richQuote, textToMatch) =>
		richQuote.replace(quoteMatcher, (_, startTag, content, endTag) =>
			[
				startTag,
				matchRichTextFromPlain(content, textToMatch),
				endTag,
			].join('\n'),
		)

	const currentUrl = new URL(window.location.href)
	const $message = document.querySelector('#message')
	const textToMatch = currentUrl.searchParams.get('selected-text')

	if ($message && isQuoteUrl(currentUrl) && textToMatch) {
		$message.textContent = quoteToPartial($message.textContent, textToMatch)
	}
})()
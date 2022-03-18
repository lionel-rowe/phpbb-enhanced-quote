;(() => {
	/* ===== common ===== */

	/** @type {?HTMLTextAreaElement} */
	const $message = document.querySelector('#message')

	/**
	 * @param {HTMLTextAreaElement} $message
	 * @returns {{ start: number, end: number }}
	 */
	const getCaretPosition = ($message) => window.getCaretPosition($message)

	/**
	 * prefer multiline quotes for consistency and readability
	 *
	 * @param {string} quote
	 */
	const coerceToMultiLine = (quote) => {
		const trimmed = quote.trim()

		return trimmed.includes('\n')
			? trimmed
			: trimmed.replace(']', ']\n').replace('[/', '\n[/')
	}

	/** @param {URL} url */
	const isQuoteUrl = (url) =>
		url.pathname.endsWith('/posting.php') &&
		['reply', 'quote'].includes(url.searchParams.get('mode'))

	const _managedParams = /** @type {const} */ ([
		'post_id',
		'user_id',
		'author',
		'time',
		'selected_text',
	])

	/**
	 * @type {{ [key in (typeof _managedParams)[number]]: key }}
	 */
	const managedParams = Object.fromEntries(
		_managedParams.map((str) => [str, str]),
	)

	/** @param {URL} url */
	const removeAllManagedParams = (url) => {
		for (const p of Object.values(managedParams)) {
			url.searchParams.delete(p)
		}
	}

	/** @typedef {Partial<Record<keyof typeof managedParams, string>>} ManagedParamsPartial */

	/**
	 * @param {URL} url
	 * @returns {ManagedParamsPartial}
	 */
	const getAllManagedParams = (url) => {
		return Object.fromEntries(
			Object.entries(managedParams).map(([k, v]) => [
				k,
				url.searchParams.get(v),
			]),
		)
	}

	/**
	 * @param {URL} url
	 * @param {Selection} selection
	 */
	const getParamsFromSelection = (selection) => {
		const selected_text = selection.toString()

		const post = selection.anchorNode?.parentElement.closest('.post')

		if (!post) {
			return null
		}

		/** @type {?HTMLAnchorElement} */
		const $quoteBtn = [...post.querySelectorAll('a[href]')].find((x) =>
			isQuoteUrl(new URL(x.href)),
		)

		/** @type {?HTMLAnchorElement} */
		const $author = post.querySelector('a[href*="/memberlist.php?"]')

		/** @type {?HTMLTimeElement} */
		const $time = post.querySelector('time')

		if (
			$quoteBtn &&
			checkSelectionForQuoteBtn(selection, $quoteBtn) &&
			selected_text &&
			$time &&
			$author
		) {
			const post_id = parseInt(
				new URL($quoteBtn.href).searchParams.get('p'),
			)
			const user_id = parseInt(
				new URL($author.href).searchParams.get('u'),
			)
			const author = $author.textContent.trim()
			const time = Math.floor(new Date($time.dateTime) / 1000)

			return {
				post_id,
				user_id,
				author,
				time,
				selected_text,
			}
		} else {
			return null
		}
	}

	/**
	 * @param {string} richText
	 * @param {string} plainFragment
	 */
	const matchRichTextFromPlain = (richText, plainFragment) => {
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
	}

	/* ===== source page (e.g. topic view page) ===== */

	/** @param {Node[]} nodes */
	const checkAllSameParentPost = (nodes) => {
		const parentPosts = nodes.map((node) =>
			node.parentElement?.closest('.post'),
		)

		return parentPosts.every(Boolean) && new Set(parentPosts).size === 1
	}

	/**
	 * @param {Selection} selection
	 * @param {HTMLAnchorElement} quoteBtn
	 */
	const checkSelectionForQuoteBtn = ({ anchorNode, focusNode }, quoteBtn) =>
		anchorNode &&
		focusNode &&
		checkAllSameParentPost([quoteBtn, anchorNode, focusNode])

	const selector = '.post-buttons a[href], .action-bar a[href]'

	/**
	 * @typedef {{
	 * 	author: string;
	 * 	post_id: number;
	 * 	time: number;
	 * 	user_id: number;
	 * }} PostInfo
	 */

	/**
	 * @type {WeakMap<HTMLAnchorElement, PostInfo>} */
	const attrsForLinks = new WeakMap()

	/**
	 * @param {HTMLAnchorElement} $link
	 */
	const getPostInfoForSamePageQuoteLink = ($link) => {
		const samePageQuoteHandler = $link.getAttribute('onclick')
		const cached = attrsForLinks.get($link)

		if (cached || samePageQuoteHandler) {
			// is same-page quote button

			if (cached) {
				return cached
			}

			const paramStr = samePageQuoteHandler.match(
				/^[\s;]*addquote\s*\((.+)\)[\s;]*$/,
			)?.[1]

			/**
			 * `paramStr` is trusted as safe JS code due to coming from an existing
			 * `onclick` function that is generated by phpBB;
			 * we intercept the params before they are passed to `addquote`,
			 * and instead selectively pass them to `generateQuote`
			 *
			 * @type {[
			 * 	number,
			 * 	string,
			 * 	string,
			 * 	{ post_id: number, time: number, user_id: number }
			 * ]}
			 */
			// eslint-disable-next-line no-eval
			const [_postId, author, _wrote, attrs] = eval(`[${paramStr}]`)

			/** @type {PostInfo} */
			const result = {
				post_id: String(attrs.post_id),
				time: String(attrs.time),
				user_id: String(attrs.user_id),
				author,
			}

			if (author && attrs) {
				attrsForLinks.set($link, { ...result, author })
				$link.removeAttribute('onclick')

				return result
			} else {
				return null
			}
		}

		return null
	}

	/**
	 * @param {Selection} selection
	 * @param {PostInfo} postInfo
	 * @param {HTMLAnchorElement} $link
	 */
	const getQuoteFromSamePagePost = (selection, postInfo, $link) => {
		const selected_text = selection.toString()

		const $richText = document.querySelector(`#message_${postInfo.post_id}`)

		const display = $richText.style.display

		$richText.style.display = 'block' // ensure proper newline rendering
		const richText = $richText.innerText // not textContent
		$richText.style.display = display // revert

		/** @type {string} */
		const content =
			selected_text.trim() && checkSelectionForQuoteBtn(selection, $link)
				? matchRichTextFromPlain(richText, selected_text)
				: richText

		return content
	}

	for (const eventType of ['mouseover', 'click']) {
		document.body.addEventListener(eventType, (e) => {
			/** @type {HTMLAnchorElement} */
			const $link = e.target.closest(selector)

			if ($link) {
				const url = new URL($link.href)
				const selection = window.getSelection()

				if (selection && isQuoteUrl(url)) {
					const selected_text = selection.toString()

					const postInfo = getPostInfoForSamePageQuoteLink($link)

					if ($message && postInfo && e.type === 'click') {
						// is same-page quote button
						e.preventDefault()
						e.stopImmediatePropagation()
						e.stopPropagation()

						const caret = getCaretPosition($message)

						const before = $message.value.slice(
							0,
							getCaretPosition($message).start,
						)
						const after = $message.value.slice(
							getCaretPosition($message).end,
						)

						const startPaddingLength =
							caret.start === 0
								? 0
								: Math.max(
										0,
										2 - before.match(/\n*$/)[0].length,
								  )

						const endPaddingLength =
							caret.end === $message.value.length
								? 0
								: Math.max(0, 2 - after.match(/^\n*/)[0].length)

						const content = getQuoteFromSamePagePost(
							selection,
							postInfo,
							$link,
						)

						window.insert_text(
							'\n'.repeat(startPaddingLength) +
								coerceToMultiLine(
									window.generateQuote(content, postInfo),
								) +
								'\n'.repeat(endPaddingLength),
						)
					} else {
						if (
							checkSelectionForQuoteBtn(selection, $link) &&
							selected_text
						) {
							url.searchParams.set('selected_text', selected_text)
						} else if (!$link.closest('.post')) {
							// is "Reply" button at bottom of thread
							const params = getParamsFromSelection(selection)

							if (params) {
								for (const [k, v] of Object.entries(params)) {
									url.searchParams.set(managedParams[k], v)
								}
							} else {
								removeAllManagedParams(url)
							}
						} else {
							removeAllManagedParams(url)
						}

						$link.href = url.href
					}
				}
			}
		})
	}

	/* ===== target page (/posting.php?mode=quote...) ===== */

	const quoteMatcher = /^(\s*\[quote[^\]]*\])([\s\S]+)(\[\/quote\]\s*)$/u

	/**
	 * @param {string} richQuote
	 * @param {string} textToMatch
	 */
	const quoteToPartial = (richQuote, textToMatch) =>
		coerceToMultiLine(
			richQuote.replace(quoteMatcher, (_, startTag, content, endTag) =>
				[
					startTag,
					matchRichTextFromPlain(content, textToMatch),
					endTag,
				].join('\n'),
			),
		)

	const currentUrl = new URL(window.location.href)

	const params = getAllManagedParams(currentUrl)
	const { selected_text, ...postInfo } = params

	if ($message && isQuoteUrl(currentUrl)) {
		/** @type {string} */
		let quote

		if (Object.values(managedParams).every((v) => params[v])) {
			quote =
				coerceToMultiLine(
					window.generateQuote(selected_text, postInfo),
				) + '\n\n'
		} else if (selected_text) {
			quote = quoteToPartial($message.textContent, selected_text) + '\n\n'
		} else {
			quote = quoteMatcher.test($message.textContent)
				? coerceToMultiLine($message.textContent) + '\n\n'
				: $message.textContent
		}

		// call window.insert_text, even if quote is blank,
		// to make sure $message always focused on page load
		$message.textContent = ''
		window.insert_text(quote)
	}
})()

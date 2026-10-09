import { defer, sprint, RangeObject } from "./utils/core";
import EpubCFI from "./epubcfi";
import Hook from "./utils/hook";
import { replaceBase } from "./utils/replacements";
import Request from "./utils/request";
import { XMLSerializer as XMLDOMSerializer } from "@xmldom/xmldom";

/**
 * Represents a Section of the Book
 *
 * In most books this is equivalent to a Chapter
 * @param {object} item  The spine item representing the section
 * @param {object} hooks hooks for serialize and content
 */
class Section {
	constructor(item, hooks){
		this.idref = item.idref;
		this.linear = item.linear === "yes";
		this.properties = item.properties;
		this.index = item.index;
		this.href = item.href;
		this.url = item.url;
		this.canonical = item.canonical;
		this.next = item.next;
		this.prev = item.prev;

		this.cfiBase = item.cfiBase;

		if (hooks) {
			this.hooks = hooks;
		} else {
			this.hooks = {};
			this.hooks.serialize = new Hook(this);
			this.hooks.content = new Hook(this);
		}

		this.document = undefined;
		this.contents = undefined;
		this.output = undefined;
	}

	/**
	 * Load the section from its url
	 * @param  {method} [_request] a request method to use for loading
	 * @return {document} a promise with the xml document
	 */
	load(_request){
		var request = _request || this.request || Request;
		var loading = new defer();
		var loaded = loading.promise;

		if(this.contents) {
			loading.resolve(this.contents);
		} else {
			request(this.url)
				.then(function(xml){
					// var directory = new Url(this.url).directory;

					this.document = xml;
					this.contents = xml.documentElement;

					return this.hooks.content.trigger(this.document, this);
				}.bind(this))
				.then(function(){
					loading.resolve(this.contents);
				}.bind(this))
				.catch(function(error){
					loading.reject(error);
				});
		}

		return loaded;
	}

	/**
	 * Adds a base tag for resolving urls in the section
	 * @private
	 */
	base(){
		return replaceBase(this.document, this);
	}

	/**
	 * Render the contents of a section
	 * @param  {method} [_request] a request method to use for loading
	 * @return {string} output a serialized XML Document
	 */
	render(_request){
		var rendering = new defer();
		var rendered = rendering.promise;
		this.output; // TODO: better way to return this from hooks?

		this.load(_request).
			then(function(contents){
				var userAgent = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
				var isIE = userAgent.indexOf('Trident') >= 0;
				var Serializer;
				if (typeof XMLSerializer === "undefined" || isIE) {
					Serializer = XMLDOMSerializer;
				} else {
					Serializer = XMLSerializer;
				}
				var serializer = new Serializer();
				this.output = serializer.serializeToString(contents);
				return this.output;
			}.bind(this)).
			then(function(){
				return this.hooks.serialize.trigger(this.output, this);
			}.bind(this)).
			then(function(){
				rendering.resolve(this.output);
			}.bind(this))
			.catch(function(error){
				rendering.reject(error);
			});

		return rendered;
	}

	/**
	 * Find a string in a section
	 * @param  {string} _query The query string to find
	 * @return {object[]} A list of matches, with form {cfi, excerpt}
	 */
	find(_query){
		var section = this;
		var matches = [];
		var query = _query.toLowerCase();
		var find = function(node){
			var text = node.textContent.toLowerCase();
			var range = section.document.createRange();
			var cfi;
			var pos;
			var last = -1;
			var excerpt;
			var limit = 150;

			while (pos != -1) {
				// Search for the query
				pos = text.indexOf(query, last + 1);

				if (pos != -1) {
					// We found it! Generate a CFI
					range = section.document.createRange();
					range.setStart(node, pos);
					range.setEnd(node, pos + query.length);

					cfi = section.cfiFromRange(range);

					// Generate the excerpt
					if (node.textContent.length < limit) {
						excerpt = node.textContent;
					}
					else {
						excerpt = node.textContent.substring(pos - limit/2, pos + limit/2);
						excerpt = "..." + excerpt + "...";
					}

					// Add the CFI to the matches list
					matches.push({
						cfi: cfi,
						excerpt: excerpt
					});
				}

				last = pos;
			}
		};

		sprint(section.document, function(node) {
			find(node);
		});

		return matches;
	};


	/**
	 * Search a string in multiple sequential Element of the section. If the document.createTreeWalker api is missed(eg: IE8), use `find` as a fallback.
	 * @param  {string} _query The query string to search
	 * @param  {int} maxSeqEle The maximum number of Element that are combined for search, default value is 5.
	 * @return {object[]} A list of matches, with form {cfi, excerpt}
	 */
	search(_query , maxSeqEle = 5){
		if (typeof(document.createTreeWalker) == "undefined") {
			return this.find(_query);
		}
		let matches = [];
		const excerptLimit = 150;
		const section = this;
		const query = _query.toLowerCase();
		const search = function(nodeList){
			const textWithCase =  nodeList.reduce((acc ,current)=>{
				return acc + current.textContent;
			},"");
			const text = textWithCase.toLowerCase();
			const pos = text.indexOf(query);
			if (pos != -1){
				const startNodeIndex = 0 , endPos = pos + query.length;
				let endNodeIndex = 0 , l = 0;
				if (pos < nodeList[startNodeIndex].length){
					let cfi;
					while( endNodeIndex < nodeList.length - 1 ){
						l += nodeList[endNodeIndex].length;
						if ( endPos <= l){
							break;
						}
						endNodeIndex += 1;
					}

					let startNode = nodeList[startNodeIndex] , endNode = nodeList[endNodeIndex];
					let range = section.document.createRange();
					range.setStart(startNode,pos);
					let beforeEndLengthCount =  nodeList.slice(0, endNodeIndex).reduce((acc,current)=>{return acc+current.textContent.length;},0) ;
					range.setEnd(endNode, beforeEndLengthCount > endPos ? endPos : endPos - beforeEndLengthCount );
					cfi = section.cfiFromRange(range);

					let excerpt = nodeList.slice(0, endNodeIndex+1).reduce((acc,current)=>{return acc+current.textContent ;},"");
					if (excerpt.length > excerptLimit){
						excerpt = excerpt.substring(pos - excerptLimit/2, pos + excerptLimit/2);
						excerpt = "..." + excerpt + "...";
					}
					matches.push({
						cfi: cfi,
						excerpt: excerpt
					});
				}
			}
		}

		const treeWalker = document.createTreeWalker(section.document, NodeFilter.SHOW_TEXT, null, false);
		let node , nodeList = [];
		while (node = treeWalker.nextNode()) {
			nodeList.push(node);
			if (nodeList.length == maxSeqEle){
				search(nodeList.slice(0 , maxSeqEle));
				nodeList = nodeList.slice(1, maxSeqEle);
			}
		}
		if (nodeList.length > 0){
			search(nodeList);
		}
		return matches;
	}

	/**
	* Reconciles the current chapters layout properties with
	* the global layout properties.
	* @param {object} globalLayout  The global layout settings object, chapter properties string
	* @return {object} layoutProperties Object with layout properties
	*/
	reconcileLayoutSettings(globalLayout){
		//-- Get the global defaults
		var settings = {
			layout : globalLayout.layout,
			spread : globalLayout.spread,
			orientation : globalLayout.orientation
		};

		//-- Get the chapter's display type
		this.properties.forEach(function(prop){
			var rendition = prop.replace("rendition:", "");
			var split = rendition.indexOf("-");
			var property, value;

			if(split != -1){
				property = rendition.slice(0, split);
				value = rendition.slice(split+1);

				settings[property] = value;
			}
		});
		return settings;
	}

	/**
	 * Get a CFI from a Range in the Section
	 * @param  {range} _range
	 * @return {string} cfi an EpubCFI string
	 */
	cfiFromRange(_range) {
		return new EpubCFI(_range, this.cfiBase).toString();
	}

	/**
	 * Get a CFI from an Element in the Section
	 * @param  {element} el
	 * @return {string} cfi an EpubCFI string
	 */
	cfiFromElement(el) {
		return new EpubCFI(el, this.cfiBase).toString();
	}

	/**
	 * Get a DOM Range for given CFI boundaries in the section
	 * @param {string|EpubCFI} startCfi
	 * @param {string|EpubCFI} [endCfi]
	 * @return {Range|null}
	 */
	getPageRange(startCfi, endCfi) {
		if (!this.document) {
			return null;
		}

		let range = null;
		if (typeof this.document.createRange !== "undefined") {
			range = this.document.createRange();
		} else {
			range = new RangeObject();
		}

		if (!startCfi && !endCfi) {
			if (range.selectNodeContents && this.document.body) {
				range.selectNodeContents(this.document.body);
			}
			return range;
		}

		let startObj = startCfi ? (startCfi instanceof EpubCFI ? startCfi : new EpubCFI(startCfi)) : null;
		let endObj = endCfi ? (endCfi instanceof EpubCFI ? endCfi : new EpubCFI(endCfi)) : null;

		// If startObj is already a range CFI
		if (startObj && startObj.range && !endCfi) {
			return startObj.toRange(this.document);
		}

		let startRange = startObj ? startObj.toRange(this.document) : null;
		let endRange = endObj ? endObj.toRange(this.document) : null;

		if (startRange && endRange) {
			range.setStart(startRange.startContainer, startRange.startOffset);
			let endContainer = endRange.endContainer || endRange.startContainer;
			let endOffset = (typeof endRange.endOffset !== "undefined" && endRange.endOffset !== null) ? endRange.endOffset : endRange.startOffset;
			range.setEnd(endContainer, endOffset);
		} else if (startRange) {
			range.setStart(startRange.startContainer, startRange.startOffset);
			if (this.document.body) {
				let last = this.document.body.lastChild || this.document.body;
				range.setEnd(last, (last.nodeType === 3) ? (last.textContent ? last.textContent.length : 0) : 1);
			}
		} else if (endRange) {
			if (this.document.body) {
				let first = this.document.body.firstChild || this.document.body;
				range.setStart(first, 0);
			}
			let endContainer = endRange.endContainer || endRange.startContainer;
			let endOffset = (typeof endRange.endOffset !== "undefined" && endRange.endOffset !== null) ? endRange.endOffset : endRange.startOffset;
			range.setEnd(endContainer, endOffset);
		}

		return range;
	}

	/**
	 * Extract serialized HTML string and plain text for a page range
	 * @param {string|EpubCFI} startCfi
	 * @param {string|EpubCFI} [endCfi]
	 * @param {object} [options]
	 * @param {boolean} [options.fullDocument=false] wrap in complete html/body
	 * @param {boolean} [options.includeStyles=true] include style tags from head
	 * @param {string} [options.className='epub-page-content'] container class
	 * @param {function} [_request] optional request method for headless / unarchive loading
	 * @return {Promise<{html: string, text: string, styles: string, cfi: {start: string, end: string}}>}
	 */
	getPageHTML(startCfi, endCfi, options = {}, _request) {
		return this.load(_request).then((contents) => {
			let range = this.getPageRange(startCfi, endCfi);
			let fragment = range ? this._extractFragment(range) : null;
			let text = (range && typeof range.toString === "function" && range.toString())
				? range.toString()
				: (fragment && fragment.textContent ? fragment.textContent : "");
			let html = "";
			let styles = "";

			// Extract styles from head if requested
			if (options.includeStyles !== false && this.document) {
				let styleNodes = this.document.querySelectorAll ? this.document.querySelectorAll("style, link[rel='stylesheet']") : [];
				for (let i = 0; i < styleNodes.length; i++) {
					styles += styleNodes[i].outerHTML || "";
				}
			}

			if (fragment) {
				let Serializer;
				if (typeof XMLSerializer !== "undefined") {
					Serializer = XMLSerializer;
				} else {
					Serializer = XMLDOMSerializer;
				}
				let serializer = new Serializer();

				if (typeof document !== "undefined" && document.createElement) {
					let temp = document.createElement("div");
					temp.className = options.className || "epub-page-content";
					temp.appendChild(fragment);
					html = temp.innerHTML;
				} else {
					let tempDoc = this.document.implementation && this.document.implementation.createHTMLDocument ? this.document.implementation.createHTMLDocument("") : null;
					let tempDiv = tempDoc ? tempDoc.createElement("div") : this.document.createElement("div");
					tempDiv.className = options.className || "epub-page-content";
					tempDiv.appendChild(fragment);
					html = serializer.serializeToString(tempDiv);
				}
			}

			if (options.fullDocument) {
				html = `<!DOCTYPE html><html><head><meta charset="utf-8">${styles}</head><body>${html}</body></html>`;
			} else if (styles && options.inlineStyles) {
				html = `${styles}${html}`;
			}

			return {
				html: html,
				text: text,
				styles: styles,
				cfi: {
					start: startCfi ? startCfi.toString() : null,
					end: endCfi ? endCfi.toString() : null
				}
			};
		});
	}

	/**
	 * Extract plain text for a page range
	 * @param {string|EpubCFI} startCfi
	 * @param {string|EpubCFI} [endCfi]
	 * @param {function} [_request]
	 * @return {Promise<string>}
	 */
	getPageText(startCfi, endCfi, _request) {
		return this.load(_request).then(() => {
			let range = this.getPageRange(startCfi, endCfi);
			if (range && typeof range.toString === "function" && range.toString()) {
				return range.toString();
			}
			let fragment = range ? this._extractFragment(range) : null;
			return fragment && fragment.textContent ? fragment.textContent : "";
		});
	}

	/**
	 * Helper to extract DocumentFragment from range in browser and headless environments
	 * @private
	 * @param {Range|RangeObject} range
	 * @return {DocumentFragment|Node}
	 */
	_extractFragment(range) {
		if (range && typeof range.cloneContents === "function") {
			return range.cloneContents();
		}

		let doc = this.document;
		let fragment = doc && doc.createDocumentFragment ? doc.createDocumentFragment() : null;
		if (!range || !range.startContainer) {
			if (doc && doc.body) {
				let clone = doc.body.cloneNode(true);
				if (fragment) {
					while (clone.firstChild) fragment.appendChild(clone.firstChild);
					return fragment;
				}
				return clone;
			}
			return fragment;
		}

		let start = range.startContainer;
		let end = range.endContainer || range.startContainer;
		let startOffset = range.startOffset || 0;
		let endOffset = (typeof range.endOffset !== "undefined" && range.endOffset !== null) ? range.endOffset : (end.textContent ? end.textContent.length : 0);

		if (start === end && start.nodeType === 3) {
			let text = start.nodeValue ? start.nodeValue.substring(startOffset, endOffset) : "";
			let node = doc.createTextNode(text);
			if (fragment) { fragment.appendChild(node); return fragment; }
			return node;
		}

		let commonAncestor = range.commonAncestorContainer || (doc.body || doc.documentElement);
		let inRange = false;
		let collectedNodes = [];

		let walk = (node) => {
			if (!node) return false;
			if (node === start) {
				inRange = true;
				if (node.nodeType === 3) {
					let text = node.nodeValue ? node.nodeValue.substring(startOffset) : "";
					collectedNodes.push(doc.createTextNode(text));
					if (start === end) { inRange = false; return true; }
					return false;
				}
			}
			if (inRange && node !== start && node !== end) {
				let containsEnd = false;
				let cur = end;
				while (cur) {
					if (cur === node) { containsEnd = true; break; }
					cur = cur.parentNode;
				}
				if (!containsEnd) {
					collectedNodes.push(node.cloneNode(true));
					return false;
				}
			}
			if (node === end) {
				if (node.nodeType === 3) {
					let text = node.nodeValue ? node.nodeValue.substring(0, endOffset) : "";
					collectedNodes.push(doc.createTextNode(text));
				} else {
					collectedNodes.push(node.cloneNode(true));
				}
				inRange = false;
				return true;
			}
			let children = node.childNodes;
			if (children) {
				for (let i = 0; i < children.length; i++) {
					let done = walk(children[i]);
					if (done) return true;
				}
			}
			return false;
		};

		walk(commonAncestor);

		if (fragment) {
			for (let i = 0; i < collectedNodes.length; i++) {
				fragment.appendChild(collectedNodes[i]);
			}
			return fragment;
		}
		return collectedNodes;
	}

	/**
	 * Unload the section document
	 */
	unload() {
		this.document = undefined;
		this.contents = undefined;
		this.output = undefined;
	}

	destroy() {
		this.unload();
		this.hooks.serialize.clear();
		this.hooks.content.clear();

		this.hooks = undefined;
		this.idref = undefined;
		this.linear = undefined;
		this.properties = undefined;
		this.index = undefined;
		this.href = undefined;
		this.url = undefined;
		this.next = undefined;
		this.prev = undefined;

		this.cfiBase = undefined;
	}
}

export default Section;

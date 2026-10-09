import {qs, qsa, querySelectorByType, filterChildren, findChildren, getParentByTagName} from "./utils/core";

/**
 * Navigation Parser
 * @param {document} xml navigation html / xhtml / ncx
 */
class Navigation {
	constructor(xml) {
		this.toc = [];
		this.tocByHref = {};
		this.tocById = {};

		this.landmarks = [];
		this.landmarksByType = {};

		this.length = 0;
		if (xml) {
			this.parse(xml);
		}
	}

	/**
	 * Parse out the navigation items
	 * @param {document} xml navigation html / xhtml / ncx
	 */
	parse(xml) {
		let isXml = xml.nodeType;
		let html;
		let ncx;

		if (isXml) {
			html = qs(xml, "html");
			ncx = qs(xml, "ncx");
		}

		if (!isXml) {
			this.toc = this.load(xml);
		} else if(html) {
			this.toc = this.parseNav(xml);
			this.landmarks = this.parseLandmarks(xml);
		} else if(ncx){
			this.toc = this.parseNcx(xml);
		}

		this.length = 0;

		this.unpack(this.toc);
	}

	/**
	 * Unpack navigation items
	 * @private
	 * @param  {array} toc
	 */
	unpack(toc) {
		var item;

		for (var i = 0; i < toc.length; i++) {
			item = toc[i];

			if (item.href) {
				this.tocByHref[item.href] = i;
			}

			if (item.id) {
				this.tocById[item.id] = i;
			}

			this.length++;

			if (item.subitems.length) {
				this.unpack(item.subitems);
			}
		}

	}

	/**
	 * Get an item from the navigation
	 * @param  {string} target
	 * @return {object} navItem
	 */
	get(target) {
		var index;

		if(!target) {
			return this.toc;
		}

		if(target.indexOf("#") === 0) {
			index = this.tocById[target.substring(1)];
		} else if(target in this.tocByHref){
			index = this.tocByHref[target];
		}

		return this.getByIndex(target, index, this.toc);
	}

	/**
	 * Get an item from navigation subitems recursively by index
	 * @param  {string} target
	 * @param  {number} index
	 * @param  {array} navItems
	 * @return {object} navItem
	 */
	getByIndex(target, index, navItems) {
		if (navItems.length === 0) {
			return;
		}

		const item = navItems[index];
		if (item && (target === item.id || target === item.href)) {
			return item;
		} else {
			let result;
			for (let i = 0; i < navItems.length; ++i) {
				result = this.getByIndex(target, index, navItems[i].subitems);
				if (result) {
					break;
				}
			}
			return result;
		}
	}

	/**
	 * Get a landmark by type
	 * List of types: https://idpf.github.io/epub-vocabs/structure/
	 * @param  {string} type
	 * @return {object} landmarkItem
	 */
	landmark(type) {
		var index;

		if(!type) {
			return this.landmarks;
		}

		index = this.landmarksByType[type];

		return this.landmarks[index];
	}

	/**
	 * Parse toc from a Epub > 3.0 Nav
	 * @private
	 * @param  {document} navHtml
	 * @return {array} navigation list
	 */
	parseNav(navHtml){
		var navElement = querySelectorByType(navHtml, "nav", "toc");
		var list = [];

		if (!navElement) return list;

		let navList = filterChildren(navElement, "ol", true);
		if (!navList) return list;

		list = this.parseNavList(navList);
		return list;
	}

	/**
	 * Parses lists in the toc
	 * @param  {document} navListHtml
	 * @param  {string} parent id
	 * @return {array} navigation list
	 */
	parseNavList(navListHtml, parent) {
		const result = [];

		if (!navListHtml) return result;
		const children = navListHtml.children || findChildren(navListHtml);
		if (!children) return result;
		
		for (let i = 0; i < children.length; i++) {
			const item = this.navItem(children[i], parent);

			if (item) {
				result.push(item);
			}
		}

		return result;
	}

	/**
	 * Create a navItem
	 * @private
	 * @param  {element} item
	 * @return {object} navItem
	 */
	navItem(item, parent) {
		let id = item.getAttribute("id") || undefined;
		let content = filterChildren(item, "a", true)
			|| filterChildren(item, "span", true);

		if (!content) {
			return;
		}

		let src = content.getAttribute("href") || "";
		
		if (!id) {
			id = src;
		}
		let text = content.textContent || "";

		let subitems = [];
		let nested = filterChildren(item, "ol", true);
		if (nested) {
			subitems = 	this.parseNavList(nested, id);
		}

		return {
			"id": id,
			"href": src,
			"label": text,
			"subitems" : subitems,
			"parent" : parent
		};
	}

	/**
	 * Parse landmarks from a Epub > 3.0 Nav
	 * @private
	 * @param  {document} navHtml
	 * @return {array} landmarks list
	 */
	parseLandmarks(navHtml){
		var navElement = querySelectorByType(navHtml, "nav", "landmarks");
		var navItems = navElement ? qsa(navElement, "li") : [];
		var length = navItems.length;
		var i;
		var list = [];
		var item;

		if(!navItems || length === 0) return list;

		for (i = 0; i < length; ++i) {
			item = this.landmarkItem(navItems[i]);
			if (item) {
				list.push(item);
				this.landmarksByType[item.type] = i;
			}
		}

		return list;
	}

	/**
	 * Create a landmarkItem
	 * @private
	 * @param  {element} item
	 * @return {object} landmarkItem
	 */
	landmarkItem(item){
		let content = filterChildren(item, "a", true);

		if (!content) {
			return;
		}

		let type = content.getAttributeNS("http://www.idpf.org/2007/ops", "type") || undefined;
		let href = content.getAttribute("href") || "";
		let text = content.textContent || "";

		return {
			"href": href,
			"label": text,
			"type" : type
		};
	}

	/**
	 * Parse from a Epub > 3.0 NC
	 * @private
	 * @param  {document} navHtml
	 * @return {array} navigation list
	 */
	parseNcx(tocXml){
		var navPoints = qsa(tocXml, "navPoint");
		var length = navPoints.length;
		var i;
		var toc = {};
		var list = [];
		var item, parent;

		if(!navPoints || length === 0) return list;

		for (i = 0; i < length; ++i) {
			item = this.ncxItem(navPoints[i]);
			toc[item.id] = item;
			if(!item.parent) {
				list.push(item);
			} else {
				parent = toc[item.parent];
				parent.subitems.push(item);
			}
		}

		return list;
	}

	/**
	 * Create a ncxItem
	 * @private
	 * @param  {element} item
	 * @return {object} ncxItem
	 */
	ncxItem(item){
		var id = item.getAttribute("id") || false,
				content = qs(item, "content"),
				src = content.getAttribute("src"),
				navLabel = qs(item, "navLabel"),
				text = navLabel.textContent ? navLabel.textContent : "",
				subitems = [],
				parentNode = item.parentNode,
				parent;

		if(parentNode && (parentNode.nodeName === "navPoint" || parentNode.nodeName.split(':').slice(-1)[0] === "navPoint")) {
			parent = parentNode.getAttribute("id");
		}


		return {
			"id": id,
			"href": src,
			"label": text,
			"subitems" : subitems,
			"parent" : parent
		};
	}

	/**
	 * Load Spine Items
	 * @param  {object} json the items to be loaded
	 * @return {Array} navItems
	 */
	load(json) {
		return json.map(item => {
			item.label = item.title;
			item.subitems = item.children ? this.load(item.children) : [];
			return item;
		});
	}

	/**
	 * forEach pass through
	 * @param  {Function} fn function to run on each item
	 * @return {method} forEach loop
	 */
	forEach(fn) {
		return this.toc.forEach(fn);
	}

	/**
	 * Get enriched chapter markers with page numbers, percentages, and CFIs
	 * @param {Locations} [locations] Locations instance with generated locations/pages
	 * @param {Spine} [spine] Spine instance to resolve section hrefs
	 * @return {Array<object>} list of chapter markers
	 */
	getChapterMarkers(locations, spine) {
		let markers = [];
		let totalPages = locations ? (locations.totalPages || (locations.total ? locations.total + 1 : 1)) : 1;

		let processItem = (item, level = 0) => {
			let page = 1;
			let cfi = null;
			let percentage = 0;
			let href = item.href || "";
			let cleanHref = href.split("#")[0];
			let targetId = href.indexOf("#") !== -1 ? href.slice(href.indexOf("#") + 1) : null;
			let section = (spine && cleanHref) ? (spine.get(cleanHref) || spine.get(href)) : null;

			// Match exact page from locations._pages first
			let pageItem = null;
			if (locations && locations._pages && locations._pages.length > 0) {
				pageItem = locations._pages.find(p => p.href === cleanHref || (p.href && cleanHref && p.href.endsWith(cleanHref)));
				if (!pageItem && section) {
					pageItem = locations._pages.find(p => p.sectionIndex === section.index);
				}
				if (pageItem) {
					page = pageItem.page;
					cfi = pageItem.startCfi;
					percentage = pageItem.percentage;
				}
			}

			// If targetId is specified and section document is available, resolve element CFI
			if (targetId && section && section.document) {
				let el = section.document.getElementById(targetId);
				if (el) {
					try {
						let elCfi = section.cfiFromElement(el);
						if (elCfi) {
							cfi = elCfi;
							if (locations && typeof locations.pageFromCfi === "function") {
								let p = locations.pageFromCfi(cfi);
								if (p) page = p;
							}
						}
					} catch (e) {
						// safely continue
					}
				}
			}

			if (!cfi && section && section.cfiBase) {
				cfi = `epubcfi(${section.cfiBase}!/4/1:0)`;
			}

			if (!pageItem && cfi && locations) {
				try {
					if (typeof locations.pageFromCfi === "function") {
						page = locations.pageFromCfi(cfi);
					} else if (typeof locations.locationFromCfi === "function") {
						let loc = locations.locationFromCfi(cfi);
						page = loc >= 0 ? loc + 1 : 1;
					}
					if (typeof locations.percentageFromCfi === "function") {
						percentage = locations.percentageFromCfi(cfi) || 0;
					}
				} catch (e) {
					// safely continue
				}
			} else if (!pageItem && locations && totalPages > 1) {
				percentage = totalPages > 1 ? ((page - 1) / (totalPages - 1)) : 0;
			}

			let marker = {
				id: item.id || href,
				href: href,
				label: item.label ? item.label.trim() : "",
				level: level,
				page: page,
				cfi: cfi,
				percentage: percentage,
				subitems: []
			};

			if (item.subitems && item.subitems.length) {
				marker.subitems = item.subitems.map(sub => processItem(sub, level + 1));
			}

			return marker;
		};

		markers = this.toc.map(item => processItem(item, 0));

		let flatList = [];
		let flatten = (list) => {
			list.forEach(m => {
				flatList.push(m);
				if (m.subitems && m.subitems.length) {
					flatten(m.subitems);
				}
			});
		};
		flatten(markers);

		for (let i = 0; i < flatList.length; i++) {
			let current = flatList[i];
			let next = flatList[i + 1];
			if (next && next.page >= current.page) {
				current.pageCount = Math.max(1, next.page - current.page);
			} else {
				current.pageCount = Math.max(1, (totalPages - current.page) + 1);
			}
		}

		return markers;
	}
}

export default Navigation;

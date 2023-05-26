const { JSDOM } = require("jsdom");


const handleAllFiles = require('./files');

const RE_WHITESPACE = /\s+/g;

const ALLOWED_TAGS = new Set([
    'a', 'aside', 'b', 'blockquote', 'br', 'code', 'em', 'figcaption', 'figure',
    'h3', 'h4', 'hr', 'i', 'iframe', 'img', 'li', 'ol', 'p', 'pre', 's',
    'strong', 'u', 'ul', 'video', 'span',
]);

const VOID_ELEMENTS = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'keygen',
    'link', 'menuitem', 'meta', 'param', 'source', 'track', 'wbr'
]);

const BLOCK_ELEMENTS = new Set([
    'address', 'article', 'aside', 'blockquote', 'canvas', 'dd', 'div', 'dl',
    'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2',
    'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'li', 'main', 'nav',
    'noscript', 'ol', 'output', 'p', 'pre', 'section', 'table', 'tfoot', 'ul',
    'video'
]);

class HtmlToNodesParser {
    constructor() {
        this.nodes = [];
        this.currentNodes = this.nodes;
        this.parentNodes = [];
        this.lastTextNode = null;
        this.tagsPath = [];
    }

    addStrNode(s) {
        if (!s) return;

        if (!this.tagsPath.includes('pre')) {
            s = s.replace(RE_WHITESPACE, ' ');

            if (!this.lastTextNode || this.lastTextNode.endsWith(' ')) {
                s = s.trimStart();
            }

            if (!s) {
                this.lastTextNode = null;
                return;
            }

            this.lastTextNode = s;
        }

        if (this.currentNodes.length && typeof this.currentNodes[this.currentNodes.length - 1] === 'string') {
            this.currentNodes[this.currentNodes.length - 1] += s;
        } else {
            this.currentNodes.push(s);
        }
    }

    removeExtraNewLines() {
        if (this.currentNodes.length > 2) {
            for (let i = 2; i < this.currentNodes.length; i++) {
                if (typeof this.currentNodes[i - 1] === 'string' &&
                    this.currentNodes[i - 1].trim() === '' &&
                    this.currentNodes[i - 2].tag === 'li' &&
                    this.currentNodes[i].tag === 'li') {
                    this.currentNodes.splice(i - 1, 1);
                    i--;
                }
            }
        }
    }

    trimNodes() {
        for (let i = 0; i < this.currentNodes.length; i++) {
            if (typeof this.currentNodes[i] !== 'string' && this.currentNodes[i].children?.length) {
                while (this.currentNodes[i].children.length > 0) {
                    const lastChild = this.currentNodes[i].children[this.currentNodes[i].children.length - 1];
                    if (typeof lastChild === 'string' && lastChild.trim() === '') {
                        this.currentNodes[i].children.pop();
                    } else {
                        break;
                    }
                }
            }
        }
    }

    replaceTag(tag) {
        if (!ALLOWED_TAGS.has(tag)) {
            if (tag == 'h1' || tag == 'h2')  return 'h3'
            return 'div'
        }
        return tag
    }

    handleStartTag(node) {
        let tag = node.tagName.toLowerCase();
        tag = this.replaceTag(tag)

        if (BLOCK_ELEMENTS.has(tag)) {
            this.lastTextNode = null;
        }

        const newNode = { tag };
        this.tagsPath.push(tag);
        this.currentNodes.push(newNode);

        if (node.attributes.length) {
            const attrs = {};
            newNode.attrs = attrs;

            for (let attr of node.attributes) {
                attrs[attr.name] = attr.value;
            }

            if (tag == 'img' || tag == 'video') {
                attrs.src = this.mediaUrlMap.get(attrs.src) || attrs.src;
            }

            if (tag == 'a' && attrs?.href.startsWith('#')) {
                attrs.href = this.idMap.get(attrs.href) || attrs.href;
            }
        }

        if (!VOID_ELEMENTS.has(tag)) {
            this.parentNodes.push(this.currentNodes);
            this.currentNodes = newNode.children = [];
        }
    }

    handleEndTag(tag) {
        tag = this.replaceTag(tag)

        if (VOID_ELEMENTS.has(tag)) {
            return;
        }

        if (!this.parentNodes.length) {
            throw new Error(`${tag} tag is missing start tag`);
        }

        this.currentNodes = this.parentNodes.pop();

        const lastNode = this.currentNodes[this.currentNodes.length - 1];

        if (lastNode.tag !== tag) {
            throw new Error(`${tag} tag closed instead of ${lastNode.tag}`);
        }

        this.tagsPath.pop();

        if (!lastNode.children || !lastNode.children.length) {
            delete lastNode.children;
        }

        if (!this.tagsPath.includes('pre')) {
            this.removeExtraNewLines();
            this.trimNodes();
        }

        for (let i = 0; i < this.currentNodes.length; i++) {
            if (this.currentNodes[i]?.tag == 'code' && this.currentNodes[i]?.children?.length > 0) {
                let newChildren = [];
                for (let j = 0; j < this.currentNodes[i].children.length; j++) {
                    if (typeof this.currentNodes[i].children[j] !== 'string')
                        newChildren.push(this.currentNodes[i].children[j])
                    else 
                        newChildren = newChildren.concat(this.currentNodes[i].children[j].split('\n').flatMap((item, index, array) => index === array.length - 1 ? [item] : [item, {tag: "br", children: []}] ))
                }
                this.currentNodes[i].children = newChildren;
            }
        }
    }

    handleData(data) {
        this.addStrNode(data);
    }

    handleEntityRef(name) {
        this.addStrNode(String.fromCodePoint(parseInt(name.replace('&#', ''), 10)));
    }

    handleCharRef(name) {
        let c;
        if (name.startsWith('x')) {
            c = String.fromCodePoint(parseInt(name.substr(1), 16));
        } else {
            c = String.fromCodePoint(parseInt(name, 10));
        }
        this.addStrNode(c);
    }

    getNodes() {
        if (this.parentNodes.length) {
            const notClosedTag = this.parentNodes[this.parentNodes.length - 1][this.parentNodes[this.parentNodes.length - 1].length - 1].tag;
            throw new Error(`${notClosedTag} tag is not closed`);
        }

        return this.nodes;
    }

    handleTitles(document) {
        const titles = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
        const idMap = new Map();
        titles.forEach(title => {
            if (!title.textContent) return;
            idMap.set(`#${title.textContent.replaceAll(RE_WHITESPACE, '-').toLowerCase()}`, `#${title.textContent.replaceAll(RE_WHITESPACE, '-')}`);
        });
        this.idMap = idMap;
    }

    async parse(htmlContent) {
        const dom = new JSDOM(htmlContent);
        this.mediaUrlMap = await handleAllFiles(dom.window.document);
        this.handleTitles(dom.window.document);
        this.traverse(dom.window.document.body);
    }

    traverse(node) {
        switch (node.nodeType) {
            case node.ELEMENT_NODE:
                this.handleStartTag(node);
                for (let child of node.childNodes) {
                    this.traverse(child);
                }
                this.handleEndTag(node.tagName.toLowerCase());
                break;
            case node.TEXT_NODE:
                this.handleData(node.data.replaceAll(/\n+/g, '\n'));
                break;
            case node.ENTITY_REFERENCE_NODE:
                this.handleEntityRef(node.data);
                break;
            case node.PROCESSING_INSTRUCTION_NODE:
                this.handleCharRef(node.data);
                break;
            default:
                break;
        }
    }
}

async function htmlToNodes(htmlContent) {
    const parser = new HtmlToNodesParser();
    await parser.parse(htmlContent);
    return parser.getNodes();
}

module.exports = {
    htmlToNodes
}
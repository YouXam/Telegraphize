const { Readability } = require('@mozilla/readability');
const axios = require('axios');
const Koa = require('koa');
const fsp = require('fs/promises');
const Router = require('@koa/router');
const { JSDOM } = require("jsdom");

const RE_WHITESPACE = /\s+/g;

const ALLOWED_TAGS = new Set([
    'a', 'aside', 'b', 'blockquote', 'br', 'code', 'em', 'figcaption', 'figure',
    'h3', 'h4', 'hr', 'i', 'iframe', 'img', 'li', 'ol', 'p', 'pre', 's',
    'strong', 'u', 'ul', 'video', 'span'
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
                // console.log(typeof this.currentNodes[i] === 'string' ? this.currentNodes[i].trim() : this.currentNodes[i].tag)
                if (typeof this.currentNodes[i] === 'string' && this.currentNodes[i].trim() === '\n' && this.currentNodes[i - 2].tag === 'li' && this.currentNodes[i].tag === 'li') {
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

    handleStartTag(node) {
        let tag = node.tagName.toLowerCase();
        if (!ALLOWED_TAGS.has(tag)) {
            tag = 'div';
        }

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

            if (tag == 'img') {
                attrs.src = `https://${process.env.VERCEL_URL}/proxy?url=${decodeURIComponent(attrs.src)}`
            }
        }

        if (!VOID_ELEMENTS.has(tag)) {
            this.parentNodes.push(this.currentNodes);
            this.currentNodes = newNode.children = [];
        }
    }

    handleEndTag(tag) {
        if (!ALLOWED_TAGS.has(tag)) {
            tag = 'div';
        }

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

        this.removeExtraNewLines();

        this.trimNodes();
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

    parse(htmlContent) {
        const dom = new JSDOM(htmlContent);
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

function htmlToNodes(htmlContent) {
    const parser = new HtmlToNodesParser();
    parser.parse(htmlContent);
    return parser.getNodes();
}


function fetchHtml(url) {
    return new Promise(async (resolve, reject) => {
        try {
            const { data: html } = await axios.get(url);
            resolve(html);
        } catch (error) {
            reject(error);
        }
    })
}

async function readability(url) {
    const html = await fetchHtml(url);
    const { document } = (new JSDOM(html, { url })).window;
    const article = new Readability(document,).parse();
    return article
}

async function publishToTelegraph(article, url, author) {
    const node = htmlToNodes(article.content)
    const domain = url.match(/https?:\/\/([^/]+)/)[1]
    const user = (await axios.get('https://api.telegra.ph/createAccount?short_name=default&author_name=default')).data.result
    const res = await axios.post('https://api.telegra.ph/createPage', {
        access_token: user.access_token,
        title: article.title,
        content: node,
        author_name: author || domain,
        author_url: url
    })
    return res.data.result
}

const app = new Koa();
const router = new Router();

router.get('/', async (ctx) => {
    ctx.body = await fsp.readFile('./index.html', 'utf8')
});

router.get('/createPage', async (ctx) => {
    const url = decodeURIComponent(ctx.query.url);
    const author = ctx.query.author ? decodeURIComponent(ctx.query.author) : '';
    try {
        const article = await readability(url);
        const page = await publishToTelegraph(article, url, author);
        ctx.set('Content-Type', 'application/json');
        ctx.body = page;
    } catch (error) {
        ctx.status = 500;
        ctx.body = 'Error generating page:' + error.message;
    }
});

router.get('/proxy', async (ctx) => {
    const url = decodeURIComponent(ctx.query.url);
    try {
        const response = await axios({
            method: 'get',
            url,
            responseType: 'stream',
            headers: {
                'Referer': '',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3',
            },
        });
        ctx.type = response.headers['content-type'];
        ctx.body = response.data;
    } catch (error) {
        ctx.status = 500;
        ctx.body = 'Error retrieving image';
    }
});

app.use(router.routes()).use(router.allowedMethods());

app.listen(3000, () => console.log('Server running on port 3000'));


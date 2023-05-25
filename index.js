const { Readability } = require('@mozilla/readability');
const { JSDOM } = require('jsdom');
const axios = require('axios');
const Koa = require('koa');
const fsp = require('fs/promises');
const Router = require('@koa/router');

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



function domToNode(domNode) {
    if (domNode.nodeType == domNode.TEXT_NODE) {
        return domNode.data;
    }
    if (domNode.nodeType != domNode.ELEMENT_NODE) {
        return false;
    }
    var nodeElement = {};
    nodeElement.tag = domNode.tagName.toLowerCase();
     for (var i = 0; i < domNode.attributes.length; i++) {
        var attr = domNode.attributes[i];
        if (attr.name == 'href' || attr.name == 'src') {
            if (!nodeElement.attrs) {
                nodeElement.attrs = {};
            }
            nodeElement.attrs[attr.name] = attr.value;
        }
    }
    if (nodeElement.tag == 'img') {
        nodeElement.attrs = {
            src: `https://${process.env.VERCEL_URL}/proxy?url=${decodeURIComponent(nodeElement.attrs.src)}`
        }
    }
    if (domNode.childNodes.length > 0) {
        nodeElement.children = [];
        for (var i = 0; i < domNode.childNodes.length; i++) {
            var child = domNode.childNodes[i];
            nodeElement.children.push(domToNode(child));
        }
    }
    return nodeElement;
}


async function publishToTelegraph(article, url, author) {
    const html = article.content
    const dom = new JSDOM(html)
    const domain = url.match(/https?:\/\/([^/]+)/)[1]
    const node = domToNode(dom.window.document.body)
    const user = (await axios.get('https://api.telegra.ph/createAccount?short_name=default&author_name=default')).data.result
    const res = await axios.post('https://api.telegra.ph/createPage', {
        access_token: user.access_token,
        title: article.title,
        content: [node],
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
        ctx.body = 'Error generating page';
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


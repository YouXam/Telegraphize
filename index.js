const { Readability } = require('@mozilla/readability');
const Koa = require('koa');
const { koaBody } = require('koa-body');
const fsp = require('fs/promises');
const Router = require('@koa/router');
const { JSDOM } = require('jsdom');
const { axios, fetchHtml, publishToTelegraph } = require('./request')

async function readability(url) {
    const html = await fetchHtml(url);
    const { document } = (new JSDOM(html, { url })).window;
    const article = new Readability(document).parse();
    return article
}

async function readabilityWithHtml(html) {
    const { document } = (new JSDOM(html)).window;
    const article = new Readability(document).parse();
    return article
}

const app = new Koa();

app.use(koaBody());

const router = new Router();

router.get('/', async (ctx) => {
    ctx.body = await fsp.readFile('./index.html', 'utf8')
});

router.all('/createPage', async (ctx) => {
    const body = ctx.request.body;
    const url = ctx.query.url ? decodeURIComponent(ctx.query.url) : body.url;
    const content = ctx.query.content ? decodeURIComponent(ctx.query.content) : body.content;
    const title = ctx.query.title ? decodeURIComponent(ctx.query.title) : body.title;
    const author = ctx.query.author ? decodeURIComponent(ctx.query.author) : body.author;
    try {
        
        const article = content ? await readabilityWithHtml(content) : await readability(url);
        if (!article) {
            ctx.status = 500;
            ctx.body = 'Error generating page, this page may not be supported.';
            return;
        }
        const page = await publishToTelegraph(article, url, author, title);
        ctx.set('Content-Type', 'application/json');
        ctx.body = {
            url: page.url,
            title: title || page.title,
            article
        }
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
            }
        });
        ctx.type = response.headers['content-type'];
        ctx.body = response.data;
    } catch (error) {
        ctx.status = 500;
        ctx.body = 'Error retrieving image';
        throw error;
    }
});

app.use(router.routes()).use(router.allowedMethods());

app.listen(3000, () => console.log('Server running on port 3000'));


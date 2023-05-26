const { Readability } = require('@mozilla/readability');
const Koa = require('koa');
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
        if (!article) {
            ctx.status = 500;
            ctx.body = 'Error generating page, this page may not be supported.';
            return;
        }
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


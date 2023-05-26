const axios = require('axios').create({
    proxy: process.env.ENV == 'DEBUG' ? {
        host: '127.0.0.1',
        port: 7890,
        protocol: 'http'
    } : undefined
})
const { htmlToNodes } = require('./parser');


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

async function publishToTelegraph(article, url, author) {
    const node = await htmlToNodes(article.content)
    // require('fs/promises').writeFile("nodes.json", JSON.stringify(node, null, '    '))
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

module.exports = {
    axios,
    fetchHtml,
    publishToTelegraph
}


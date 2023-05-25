const axios = require('axios').create({
    proxy: process.env.ENV == 'DEBUG' ? {
        host: '127.0.0.1',
        port: 7890,
        protocol: 'http'
    } : undefined
})
const { v4: uuidv4 } = require('uuid');
const fsp = require('fs/promises');
const FormData = require('form-data');
const path = require('path');
const fileTypes = {
    'gif': 'image/gif',
    'jpeg': 'image/jpeg',
    'jpg': 'image/jpg',
    'png': 'image/png',
    'mp4': 'video/mp4'
};
const reverseFileTypes = {};
for (const key in fileTypes) {
    reverseFileTypes[fileTypes[key]] = key;
}
async function uploadToTelegraph(pathToFile) {
    const fileExt = path.extname(pathToFile).substring(1);
    const file = await fsp.readFile(pathToFile);
    const formData = new FormData();
    formData.append('file', file, {
        filename: 'file',
        contentType: fileTypes[fileExt],
    });
    const response = await axios.post('https://telegra.ph/upload', formData);
    if (response.status !== 200) {
        return null
    }
    return `https://telegra.ph${response.data[0].src}`;
}
async function downloadAndUploadFile(url) {
    try {
        const response = await axios({
            method: 'get',
            url,
            responseType: 'arraybuffer',
            headers: {
                'Referer': '',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3',
            }
        });
        const contentType = response.headers['content-type'];
        if (!contentType || reverseFileTypes[contentType] === undefined) {
            return { originalUrl: url, telegraphUrl: null };
        }
        const tempFilePath = uuidv4() + '.' + reverseFileTypes[contentType];
        await fsp.writeFile(tempFilePath, response.data);
        const telegraphUrl = await uploadToTelegraph(tempFilePath);
        await fsp.unlink(tempFilePath);
        return { originalUrl: url, telegraphUrl: telegraphUrl };
    } catch (error) {
        console.log(`Failed to download and upload file: ${url}, Error: ${error.message}`);
        return { originalUrl: url, telegraphUrl: null };
    }
};

async function handleAllFiles(document) {
    const mediaUrls = Array.from(document.querySelectorAll('img, video')).map(el => el.src);
    const mediaUrlMap = new Map();
    const uploadPromises = mediaUrls.map(downloadAndUploadFile);
    const uploadResults = await Promise.allSettled(uploadPromises);
    uploadResults.forEach(result => {
        if (result.status === 'fulfilled' && result.value.originalUrl !== null && result.value.telegraphUrl !== null) {
            mediaUrlMap.set(result.value.originalUrl, result.value.telegraphUrl);
        }
    });
    return mediaUrlMap;
}

module.exports = handleAllFiles
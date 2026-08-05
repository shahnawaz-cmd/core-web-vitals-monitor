const fs = require('fs');

const sitesJson = JSON.parse(fs.readFileSync('./sites.json', 'utf8'));

const newSites = [];
const matrix = [];

for (const site of sitesJson.sites) {
    if (site.name === 'Window Sticker Domains') {
        // Break this up into individual domains
        const domainMap = {};
        for (const urlObj of site.urls) {
            const urlObjUrl = new URL(urlObj.url);
            const hostname = urlObjUrl.hostname.replace('www.', '');
            if (!domainMap[hostname]) {
                domainMap[hostname] = {
                    name: hostname.split('.')[0].toUpperCase() + ' Window Sticker',
                    urls: []
                };
            }
            domainMap[hostname].urls.push(urlObj);
        }
        
        for (const [hostname, data] of Object.entries(domainMap)) {
            newSites.push({
                name: data.name,
                urls: data.urls
            });
            matrix.push({
                id: data.name.toLowerCase().replace(/[^a-z0-9]/g, ''),
                url: `https://${hostname}`
            });
        }
    } else {
        newSites.push(site);
        matrix.push({
            id: site.name.toLowerCase().replace(/[^a-z0-9]/g, ''),
            url: site.urls[0].url
        });
    }
}

sitesJson.sites = newSites;
fs.writeFileSync('./sites.json', JSON.stringify(sitesJson, null, 2));
fs.writeFileSync('./sites-matrix.json', JSON.stringify(matrix, null, 2));

console.log(`Rebuilt sites.json with ${newSites.length} sites.`);
console.log(`Rebuilt sites-matrix.json with ${matrix.length} sites.`);

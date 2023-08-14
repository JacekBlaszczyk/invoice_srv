const PDFExtract = require('pdf.js-extract').PDFExtract;
const pdfExtract = new PDFExtract();
const options = {}; /* see below */
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const app = express();
const path = require("path");
const multer = require('multer');
const axios = require('axios');

const storage = multer.diskStorage({
    destination: "../uploads/",
    filename: (req, file, callback) => {
        callback(
            null,
            file.fieldname + "-" + Date.now() + path.extname(file.originalname)
        )
    }
})

const upload = multer({ storage: storage })

app.use(bodyParser.json({
    extended: true
}));
app.use(bodyParser.urlencoded({
    extended: true
}));

app.use(cors());

app.use(function(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
    res.header('Access-Control-Allow-Methods', 'PUT, POST, GET, DELETE, OPTIONS');
    next();
});

app.post("/invoice",
    upload.any('invoice'),
    (req, res) => {
        console.log(req);
        const promises = [];
        const allItems = [];
        req.files.forEach(file => {
            promises.push(pdfExtract.extract("../uploads/" + file.filename, options));
        });
        Promise.all(promises).then(values => {
                values.forEach(data => {
                    // if (err) return console.log(err);
                    let rows = [];
                    let index = 1;
                    let content = []
                    const items = [];
                    data.pages.forEach(page => {
                        page.content.forEach(el => {
                            content.push({...el, pageNr: page.pageInfo.num });
                        })
                    })
                    content.sort((a, b) => {
                        if (a.pageNr !== b.pageNr) {
                            return a.pageNr - b.pageNr
                        }
                        return a.y - b.y
                    }).forEach(el => {
                        let found = rows.find(elem => elem.y === el.y && elem.pageNr === el.pageNr);
                        if (found) {
                            found.content.push(el.str);
                        } else {
                            rows.push({ y: el.y, content: [el.str], index, pageNr: el.pageNr });
                            index++;
                        }
                    })
                    
                    rows.sort((a, b) => {
                        if (a.pageNr !== b.pageNr) {
                            return a.pageNr - b.pageNr
                        }
                        return a.y - b.y
                    });
                    if (rows[0].content[0] === 'Lp' && rows[0].content[2] === 'Przedmiot'){
                        rows.forEach(row => {
                            if (row.content[0] !== 'Lp' && row.content[0] !== 'SUMA'){
                            allItems.push( {
                                name: row.content[2],
                                amount: parseInt(row.content[6]),
                                unitPrice: parseFloat(row.content[4])
                            } )
                        }
                        })
                    } else {
                    const previousIndex = rows.findIndex(el => el.content[0] === 'WCZEŚNIEJSZE BRAKI DOŁĄCZONE DO BIEŻĄCEGO ZAMÓWIENIA');
                    const focusIndex = rows.findIndex(el => el.content[0] === 'MATERIAŁY POMOCNE W SPRZEDAŻY (bez opustu)');
                    
                    const tempItems = [...rows.slice(rows.findIndex(el => el.content[0] === 'PRODUKTY Z BIEŻĄCEGO KATALOGU') + 1, rows.findIndex(el => el.content[0] === 'RAZEM' || el.content[1] === 'RAZEM'))];
                    if (previousIndex > -1) {
                        tempItems.push(...rows.slice(previousIndex + 1, rows.findIndex((el, idx) => idx > previousIndex && (el.content[0] === 'RAZEM' || el.content[1] === 'RAZEM'))))
                    }
                    if (focusIndex > -1) {
                        tempItems.push(...rows.slice(focusIndex + 1, rows.findIndex((el, idx) => idx > focusIndex && (el.content[0] === 'RAZEM' || el.content[1] === 'RAZEM'))))
                    }
                    for (let i = 0; i < tempItems.length;) {
                        let row = tempItems[i];
                        if (row.content[8] === "Zestaw" || row.content[9] === "Zestaw") {
                            let j = i + 1;
                            const item = {
                                name: row.content[0] === '' ? row.content[5] : row.content[4],
                                unitPrice: 0,
                                sku: row.content[0] === '' ? (row.content[3] ? row.content[3].replace("-", "") : "") : (row.content[2] ? row.content[2].replace("-", "") : "")
                            };
                            while (tempItems[j] && tempItems[j].content && tempItems[j].content.length && ((!!tempItems[j].content[4] && tempItems[j].content[4].startsWith("Skł.")) || (!!tempItems[j].content[5] && tempItems[j].content[5].startsWith("Skł.")) || tempItems[j].content.length < 20)) {
                                let component = tempItems[j];
                                let nextComponent = tempItems[j + 1] && tempItems[j + 1].content && tempItems[j + 1].content.length ? tempItems[j + 1] : null;
                                if (component.content.length > 19) {
                                    item.amount = item.amount ? item.amount : component.content[0] === '' ? parseInt(component.content[7]) : (nextComponent && nextComponent.content.length === 1) ? parseInt(component.content[5]) : parseInt(component.content[6])
                                    item.unitPrice += isNaN(component.content[0] === '' ? Math.round((parseFloat(component.content[19]) / parseInt(component.content[7])) * 100) / 100 : (nextComponent && nextComponent.content.length === 1) ? Math.round((parseFloat(component.content[17]) / parseInt(component.content[5])) * 100) / 100 : Math.round((parseFloat(component.content[18]) / parseInt(component.content[6])) * 100) / 100) ? 0 : component.content[0] === '' ? Math.round((parseFloat(component.content[19]) / parseInt(component.content[7])) * 100) / 100 : (nextComponent && nextComponent.content.length === 1) ? Math.round((parseFloat(component.content[17]) / parseInt(component.content[5])) * 100) / 100 : Math.round((parseFloat(component.content[18]) / parseInt(component.content[6])) * 100) / 100
                                }
                                j++;
                                i++;
                            }
                            items.push(item);
                            i++;
                        } else {
                            items.push({
                                name: row.content[0] === '' ? row.content[5] : row.content[4],
                                amount: row.content[0] === '' ? parseInt(row.content[7]) : parseInt(row.content[6]),
                                unitPrice: row.content[0] === '' ? Math.round((parseFloat(row.content[19]) / parseInt(row.content[7])) * 100) / 100 : Math.round((parseFloat(row.content[18]) / parseInt(row.content[6])) * 100) / 100,
                                sku: row.content[0] === '' ? (row.content[3] ? row.content[3].replace("-", "") : "") : (row.content[2] ? row.content[2].replace("-", "") : "")
                            })
                            i++;
                        }
                    }
                    // tempItems.forEach(row => {

                    //         items.push({
                    //             name: row.content[0] === '' ? row.content[5] : row.content[4],
                    //             amount: row.content[0] === '' ? parseInt(row.content[7]) : parseInt(row.content[6]),
                    //             unitPrice: row.content[0] === '' ? Math.round((parseFloat(row.content[19]) / parseInt(row.content[7])) * 100) / 100 : Math.round((parseFloat(row.content[18]) / parseInt(row.content[6])) * 100) / 100,
                    //             sku: row.content[0] === '' ? (row.content[3] ? row.content[3].replace("-", "") : "") : (row.content[2] ? row.content[2].replace("-", "") : "")
                    //         })

                    // });
                    items.filter(el => el.name && !isNaN(el.unitPrice) && !isNaN(el.amount)).forEach(item => {
                        var found = allItems.find(el => el.name === item.name);
                        if (found) {
                            var wholePrice = found.amount * found.unitPrice + item.amount * item.unitPrice;
                            found.amount += item.amount;
                            found.unitPrice = Math.round((wholePrice / found.amount) * 100) / 100;
                        } else {
                            allItems.push(item);
                        }
                    })
                }

                })
                res.send(allItems.sort((a, b) => b.amount - a.amount));
            })
            // pdfExtract.extract("../uploads/" + req.file.filename, options, (err, data) => {


        // });
    });
// app.post("/invoice", (req,res) => {
//     console.log(req);
// })
app.listen(process.env.PORT || 8081, function() {
    console.log("Server started on port 8081");
});
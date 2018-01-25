const functions = require("firebase-functions");
const DialogflowApp = require("actions-on-google").DialogflowApp; // Google Assistant helper library
const rp = require("request-promise");
const moment = require("moment");

const MAX_RESULTS = 8;

// // Create and Deploy Your First Cloud Functions
// // https://firebase.google.com/docs/functions/write-firebase-functions
//
exports.dialogflowFirebaseFulfillment = functions.https.onRequest((req, resp) => {
    console.log(`Dialogflow Request headers: ${JSON.stringify(req.headers)}`);
    console.log(`Dialogflow Request body: ${JSON.stringify(req.body)}`);

    const app = new DialogflowApp({request: req, response: resp});

    let actionMap = new Map();
    actionMap.set("input.welcome", welcomeIntent);
    actionMap.set("input.unknown", unknownIntent);
    actionMap.set("default", defaultIntent);
    actionMap.set("StockingsByCounty", byCountyIntent);
    actionMap.set("StockingsByDate", byDateIntent);
    actionMap.set("StockingsDefault", byDefaultIntent);
    app.handleRequest(actionMap);
});

function welcomeIntent(app) {
    app.ask("Welcome to Virginia Trout Buddy! Try asking for recent stockings or stockings on a specific day.");
}

function unknownIntent(app) {
    app.ask("I'm having trouble, can you try that again?");
}

function defaultIntent(app) {
    app.ask("Try asking for recent stockings.");
}

function byDefaultIntent(app) {
    retrieveStockings().then(stockings => {
        let response;

        // check to ensure there was stocking data
        if (stockings.length === 0) {
            response = app.buildRichResponse()
                .addSimpleResponse({
                    speech: `<speak>The <say-as interpret-as="characters">VDGIF</say-as> currently doesn't have any stocking information.</speak>`,
                    displayText: `The VDGIF currently doesn't have any stocking information.`
                });
        } else {
            // get out last day of stocking information and present only information on that day
            const date = moment(stockings[0].date);
            const filtered = stockings.filter(stocking => date.isSame(moment(stocking.date)));
            const speech = (dateFunc) => `The last stocking${filtered.length > 1 ? "s were" : " was"} on ${dateFunc(date)}.  ${filtered.length > 1 ? "They were" : "It was"} performed at ${aggregateStockingLocations(filtered)}.`;
            response = app
                .buildRichResponse()
                .addSimpleResponse({
                    speech: `<speak>${speech(ssmlDate)}</speak>`,
                    displayText: `${speech(textDate)}`
                })
                .addBasicCard(createStockingMapCard(app, filtered));
        }

        if (app.getContext("google_assistant_welcome")) {
            app.tell(response);
        } else {
            app.ask(response);
        }
    }).catch(err => {
        console.error(err);
        app.tell(`There was a problem communicating with the Virginia Department of Game and Inland Fisheries.`);
    });
}

function byDateIntent(app) {
    try {
        const startDate = normalizeSlotDate(app.getArgument("StartDate"));
        const endDate = normalizeSlotDate(app.getArgument("EndDate"));

        if (startDate && endDate) {
            byDateRange(app, startDate, endDate);
            return;
        } else if (!startDate && !endDate) {
            throw new Error("UnknownDate")
        }

        retrieveStockings(startDate).then(stockings => {
            let response;

            // check to ensure there was stocking data
            if (stockings.length === 0) {
                const speech = (dateFunc) => `There were no stockings for ${dateFunc(startDate)}`;
                response = app.buildRichResponse().addSimpleResponse({
                    speech: `<speak>${speech(ssmlDate)}</speak>`,
                    displayText: speech(textDate)
                });
            } else if (stockings.length > MAX_RESULTS) {
                const speech = "There were too many stockings to discuss.  Trying narrowing your search.";
                response = app.buildRichResponse().addSimpleResponse(speech);
            } else {
                const speech = (dateFunc) => `On ${dateFunc(startDate)}, there were ${stockings.length} stocking${stockings.length > 1 ? "s" : ""}.  ${stockings.length > 1 ? "They were" : "It was"} performed at ${aggregateStockingLocations(stockings)}.`;
                response = app
                    .buildRichResponse()
                    .addSimpleResponse({
                        speech: `<speak>${speech(ssmlDate)}</speak>`,
                        displayText: `${speech(textDate)}`
                    })
                    .addBasicCard(createStockingMapCard(app, stockings));
            }

            if (app.getContext("google_assistant_welcome")) {
                app.tell(response);
            } else {
                app.ask(response);
            }
        }).catch(err => {
            console.error(err);
            throw err;
        });
    } catch (e) {
        if (e.message === "InvalidDate") {
            app.tell({
                speech: `<speak>A date provided was invalid. Please try your request again using a valid date like <say-as interpret-as="date" format="dm">09-02</say-as></speak>`,
                displayText: `A date provided was invalid. Please try your request again using a valid date like February 9th.`
            });
        } else if (e.message === "UnknownDate") {
            app.tell(`I sometimes have problems with dates.  Try to give a specific date like February 9th or a relative day like yesterday or last Thursday.`);
        } else {
            app.tell(`There was a problem communicating with the Virginia Department of Game and Inland Fisheries.`);
        }
    }
}

function byDateRange(app, startDate, endDate) {
    console.log(`Stockings by Date Range received`);

    if (startDate.isAfter(endDate)) {
        app.tell(`An invalid date range has been provided.  Please use a valid date range.`);
        return;
    }

    retrieveStockings(startDate, endDate).then(stockings => {
        let response;

        // check to ensure there was stocking data
        if (stockings.length === 0) {
            const speech = (dateFunc) => `There were no stockings between ${dateFunc(startDate)} and ${dateFunc(endDate)}`;
            response = app.buildRichResponse().addSimpleResponse({
                speech: `<speak>${speech(ssmlDate)}</speak>`,
                displayText: speech(textDate)
            });
        } else if (stockings.length > MAX_RESULTS) {
            const speech = "There were too many stockings to discuss.  Trying narrowing your search.";
            response = app.buildRichResponse().addSimpleResponse(speech);
        } else {
            const speech = (dateFunc) => `Between ${dateFunc(startDate)} and ${dateFunc(endDate)}, there were ${stockings.length} stocking${stockings.length > 1 ? "s" : ""}.  ${stockings.length > 1 ? "They were" : "It was"} performed at ${aggregateStockingAll(stockings)}.`;
            response = app
                .buildRichResponse()
                .addSimpleResponse({
                    speech: `<speak>${speech(ssmlDate)}</speak>`,
                    displayText: `${speech(textDate)}`
                })
                .addBasicCard(createStockingMapCard(app, stockings));
        }

        if (app.getContext("google_assistant_welcome")) {
            app.tell(response);
        } else {
            app.ask(response);
        }
    }).catch(err => {
        console.error(err);
        app.tell(`There was a problem communicating with the Virginia Department of Game and Inland Fisheries.`);
    });
}

function byCountyIntent(app) {
    console.log(`StockingsByCounty intent received`);

    const county = app.getArgument("County");

    const endDate = moment();
    const startDate = moment(endDate);
    startDate.month(endDate.month() - 2);

    retrieveStockings(startDate, endDate).then(stockings => {
        const filtered = stockings.filter(stocking => stocking.county.toLowerCase() === county.toLowerCase());

        let response;

        // check to ensure there was stocking data
        if (filtered.length === 0) {
            const speech = `No stocking information was found for ${county}`;
            response = app.buildRichResponse()
                .addSimpleResponse(speech);
        } else {
            const speech = (dateFunc) => `For ${county}, there ${filtered.length > 1 ? "were" : "was"} ${filtered.length} stocking${filtered.length > 1 ? "s" : ""}.  ${filtered.length > 1 ? "They were" : "It was"} performed on ${aggregateStockingDates(filtered, dateFunc)}.`;
            response = app
                .buildRichResponse()
                .addSimpleResponse({
                    speech: `<speak>${speech(ssmlDate)}</speak>`,
                    displayText: `${speech(textDate)}`
                })
                .addBasicCard(createStockingMapCard(app, filtered));
        }

        if (app.getContext("google_assistant_welcome")) {
            app.tell(response);
        } else {
            app.ask(response);
        }
    }).catch(err => {
        console.error(err);
        app.tell(`There was a problem communicating with the Virginia Department of Game and Inland Fisheries.`);
    });
}

function retrieveStockings(startDate, endDate) {
    let url = "https://et4vzi8cvb.execute-api.us-east-1.amazonaws.com/prod/stockings";
    if (startDate) {
        console.log(`start date: ${startDate.format()}`);
        url += `?startDate=${encodeURIComponent(startDate.format())}`;
    }

    endDate = endDate ? endDate : startDate;

    if (endDate) {
        console.log(`end date: ${endDate.format()}`);
        url += `&endDate=${encodeURIComponent(endDate.format())}`;
    }

    console.log(`Using ${url} for the query`);

    return rp({
        method: "GET",
        uri: url,
        json: true
    }).then(entries => {
        console.log(`${entries.length} entries found for url ${url}`);
        return entries;
    });
}

function aggregateStockingAll(stockings) {
    return makeGoodListGrammar(stockings.map(stocking => `${stocking.water} in ${stocking.county} on ${ssmlDate(stocking.date)}`));
}

function aggregateStockingLocations(stockings) {
    return makeGoodListGrammar(stockings.map(stocking => `${stocking.water} in ${stocking.county}`));
}

function aggregateStockingDates(stockings, dateFunc) {
    return makeGoodListGrammar(stockings.map(stocking => `${dateFunc(stocking.date)} at ${stocking.water}`));

}

function makeGoodListGrammar(descriptions) {
    if (descriptions.length === 1) {
        return descriptions[0];
    } else {
        return descriptions.map((description, index) => `${index === 0 ? "" : ", "}${index === descriptions.length - 1 ? "and " : ""}${description}`).join("");
    }
}

function normalizeSlotDate(value) {
    if (value) {
        let date = moment(value);

        if (date.isValid()) {
            const now = moment();

            if (date.isAfter(now) && moment(date).subtract(8, "d").isBefore(now)) {
                // if date is after right now and the difference is less than 7 days
                // subtract week
                date.subtract(7, "d");
            } else if (date.isAfter(now)) {
                // assume we need to remove a year
                date.year(date.year() - 1);
            }
        } else if (value.length === 4) {
            date = moment(`${value}-01-01`)
        } else {
            throw new Error("InvalidDate");
        }

        return date;
    }
}

function ssmlDate(date) {
    date = moment(date);
    return `<say-as interpret-as="date" format="dm">${date.format("DD-MM")}</say-as>`;
}

function textDate(date) {
    date = moment(date);
    return date.format("MMM DD");
}

function createStockingMapCard(app, stockings) {
    const url = (x, y) => `https://maps.googleapis.com/maps/api/staticmap?&size=${x}x${y}&type=hybrid` + stockings.map((stocking, index) => `&markers=label:${index + 1}|${stocking.water},${stocking.county},VA`).join("");

    return app.buildBasicCard()
        .setImage(url(192, 192), "Trout Stocking Locations")
        .setBodyText(stockings.map((stocking, index) => `**${index + 1}.** ${stocking.water.trim()}`).join("  "))
        .addButton("Larger Map", url(340, 340));
}



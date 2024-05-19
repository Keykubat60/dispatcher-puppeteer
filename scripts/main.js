const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');
const NodeGeocoder = require('node-geocoder');
const fs = require('fs');
const path = require('path');
const { Console } = require('console');
require('dotenv').config();

puppeteer.use(StealthPlugin());

const { USER_EMAIL, USER_PASSWORD, UNTERNEHMEN, WEBHOOK_ADRESSE } = process.env;
const cookiesPath = path.resolve(__dirname, `../cookies/${UNTERNEHMEN}.json`);
var first_loop = false;

var Status = ""
var Counter = ""

var login_attempts = 0
var max_login_attempts = 3

const geocoder = NodeGeocoder({
    provider: 'openstreetmap'
});

async function humanType(page, selector, text) {
    for (let char of text) {
        await page.type(selector, char);
        await page.waitForTimeout(Math.floor(Math.random() * 100) + 50);
    }
}

async function sendDataViaWebhook(orderData, loggedIn = true) {
    if(loggedIn){
        try {
            const response = await axios.post(WEBHOOK_ADRESSE, orderData);
            return response.data;
        } catch (error) {
            console.error('Webhook Fehler: ', error);
            return null;
        }
    }
    else{


        const response = await axios.post(WEBHOOK_ADRESSE, orderData);

        //await sendDataViaWebhook(aliveData);
    }

}

async function acceptTrip(orderElement) {
    try {
        const buttonSelector = 'button._css-fBvEmy._css-kkRZjq'; // Angepasster Selektor, um den spezifischen Button zu zielen

        const button = await orderElement.$(buttonSelector); // Selektieren Sie den Button innerhalb des orderElements

        setTimeout(async function () {
            if (button) {
                try {
                    await button.click(); // Klicken Sie auf den Button
                    console.log("Auftrag akzeptiert");
                } catch (error) {
                    console.error('Fehler beim Klicken auf den Button:', error);
                }
            } else {
                console.log("Button nicht innerhalb von tbody gefunden");
            }
        }, 5000); // 5 Sekunden Verzögerung

    } catch (error) {
        console.error('Fehler beim Akzeptieren des Auftrags: Button nicht gefunden');
    }
}



async function getDistance(origin, destination) {
    try {
        const [location1, location2] = await Promise.all([
            geocoder.geocode(origin),
            geocoder.geocode(destination)
        ]);

        if (!location1.length || !location2.length) {
            console.log('Eine oder beide Adressen konnten nicht gefunden werden.');
            return 0;
        }

        const coords1 = [location1[0].latitude, location1[0].longitude];
        const coords2 = [location2[0].latitude, location2[0].longitude];

        const distance = require('geolib').getDistance(
            { latitude: coords1[0], longitude: coords1[1] },
            { latitude: coords2[0], longitude: coords2[1] }
        ) / 1000; // in km

        return distance;
    } catch (error) {
        console.error('Fehler bei der Berechnung der Entfernung:', error);
        return 0;
    }
}

async function sendLiveCheck(page) {
    while (true) {
        try{
            await new Promise(resolve => setTimeout(resolve, 300000)); // 10 Minuten warten
            await page.goto('https://vsdispatch.uber.com/', { waitUntil: 'networkidle2' });
            await new Promise(resolve => setTimeout(resolve, 10000)); // 10 Minuten warten
    
            const aliveData = {
                unternehmen: UNTERNEHMEN,
                status: Status,
                auftraege: Counter,
            };
            Counter = 0
            await sendDataViaWebhook(aliveData);
            console.log(`Live-Check für '${UNTERNEHMEN}' gesendet.`);
        }catch(e){
            console.log("Fehler mit sendLiveCheck: ", e)
        }

    }
}

async function processOrder(orderElement) {
    try {
        const orderData = await orderElement.evaluate(() => {
            const getTextContent = (selector) => document.querySelector(selector)?.innerText || '';
            return {
                price: getTextContent('td._css-fHeobO'),
                pickupAddress: getTextContent('td:nth-of-type(3)'),
                destinationAddress: getTextContent('td:nth-of-type(4)'),
                driverName: getTextContent('td:nth-of-type(5)'),
                consumer: getTextContent('td:nth-of-type(6)')
            };
        });

        //const distance = await getDistance(orderData.pickupAddress, orderData.destinationAddress);

        //orderData.entfernung = distance.toFixed(2);
        orderData.unternehmen = UNTERNEHMEN;
        console.log('Order processed:', orderData);

        // Send order data via webhook and accept the trip
        
        // Send order data via webhook and accept the trip concurrently
        await Promise.allSettled([
            sendDataViaWebhook(orderData),
            acceptTrip(orderElement)
        ]);
        

    } catch (error) {
        console.error('Fehler bei der Verarbeitung der Bestellung:', error);
    }
}

async function login(page, screenshotDir) {
    try {
        await page.goto('https://vsdispatch.uber.com/', { waitUntil: 'networkidle2' });
        await page.screenshot({ path: `${screenshotDir}/step1.png` });

        await page.waitForSelector('#PHONE_NUMBER_or_EMAIL_ADDRESS', { timeout: 5000 });
        await humanType(page, '#PHONE_NUMBER_or_EMAIL_ADDRESS', USER_EMAIL);
        await page.screenshot({ path: `${screenshotDir}/step2.png` });

        await page.click('#forward-button');
        await page.waitForTimeout(1000);
        await page.screenshot({ path: `${screenshotDir}/step3.png` });

        try {
            await page.waitForSelector('#PASSWORD', { timeout: 3000 });
        } catch {
            try {
                await page.waitForSelector('#alt-PASSWORD', { timeout: 3000 });
            } catch {
                await page.click('#alt-alternate-forms-option-modal');
                await page.waitForTimeout(1000);
                await page.screenshot({ path: `${screenshotDir}/step4.png` });
    
                await page.click('#alt-more-options-modal-password');
                await page.waitForSelector('#PASSWORD');
                await page.screenshot({ path: `${screenshotDir}/step5.png` });
            }


        }

        await humanType(page, '#PASSWORD', USER_PASSWORD);
        await page.screenshot({ path: `${screenshotDir}/step6.png` });
        await page.waitForTimeout(1000);
        await page.click('#forward-button');
        await page.waitForNavigation();
        await page.screenshot({ path: `${screenshotDir}/step7.png` });
        const cookies = await page.cookies();
        fs.writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2));
        console.log('Login erfolgreich!');
    } catch (error) {
        await page.screenshot({ path: `${screenshotDir}/step8.png` });
        console.log('Login fehlgeschlagen:', "No Alerternate form option");
    }
}

async function checkAndProcessOrders(page) {
    try{
        const currentOrders = await page.$$('tr.MuiTableRow-root');
        return currentOrders

    }catch{

        try{
            await page.waitForSelector('tr.MuiTableRow-root', { timeout: 5000 });
            const currentOrders = await page.$$('tr.MuiTableRow-root');
            return currentOrders;

        }catch{
            return 0
        }


    }
  }
  

async function main() {
    console.log('Code läuft');
    const browser = await puppeteer.launch({
        executablePath: '/usr/bin/chromium',
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    const screenshotDir = path.resolve(__dirname, `../screenshots/${UNTERNEHMEN}`);

    // Ensure screenshot directory exists
    if (!fs.existsSync(screenshotDir)) {
        fs.mkdirSync(screenshotDir, { recursive: true });
    }

    // Load cookies if they exist
    console.log('Checking for cookies at:', cookiesPath);
    if (fs.existsSync(cookiesPath) && fs.lstatSync(cookiesPath).isFile()) {
        const cookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf8'));
        console.log('Cookies found');
        if (cookies.length > 0) {
            await page.setCookie(...cookies);
            console.log('Cookies loaded successfully.');
        }
    } else {
        console.log('No cookies found.');
    }

    // Test if cookies are still valid by navigating to a known page
    try {
        await page.goto('https://vsdispatch.uber.com/', { waitUntil: 'networkidle2' });
        await page.screenshot({ path: `${screenshotDir}/initial.png` });

        // Check if login is still valid by looking for a specific element that is present only when logged in
        const loggedIn = await page.evaluate(() => {
            return document.querySelector('thead.MuiTableHead-root') !== null;
        });

        if (!loggedIn) {
            console.log('Cookies are not valid anymore, performing login...');
            await login(page, screenshotDir);
            first_loop = true;
        } else {
            console.log('Logged in with cookies.');
            first_loop = true;
        }
    } catch (error) {
        console.log('Navigation failed:', error);
        await login(page, screenshotDir);
    }

    let previousOrderCount = 1;
    const processedOrders = new Set();
    const MAX_PROCESSED_ORDERS = 5; // Adjust this value as needed
    
    const checkOrdersInterval = setInterval(async () => {
        try {
        // Wait for the selector to ensure the page has loaded
        await checkAndProcessOrders(page)
        const currentOrders = await page.$$('tr.MuiTableRow-root');
        
        // Check if there are new orders
        if (currentOrders.length !== previousOrderCount) {
    
            for (const order of currentOrders.slice(previousOrderCount)) {
            const orderId = await order.evaluate(el => el.innerText);
    
            if (!processedOrders.has(orderId)) {
                console.log("New trip(s) arrived");

              console.log("Processing new order:", orderId);
              processedOrders.add(orderId);
              Counter++
              processOrder(order);
            }
          }
    
          // Update the previous order count to the current number of orders
          previousOrderCount = currentOrders.length;
          Status = "Ich bin Eingeloggt."
        } else if (currentOrders.length === 0) {
          console.log("!------------ Ich bin Ausgeloggt ------------!");

          if(login_attempts < max_login_attempts)
          {
            login_attempts++
            console.log("Anzahl an versuchen: ", login_attempts)
            console.log("!------------ Versuche mich wieder Einzuloggen ------------!");
            clearInterval(checkOrdersInterval);

            // Restart the main function after a delay
            setTimeout(() => {

              main();
            }, 10000); // Restart after 10 seconds
          
          }
          else{
            Status = "Ich bin Ausgeloggt!!"
            console.log("!------------ Ich habe die Maximale Login Versuche erreicht ------------!")
            clearInterval(checkOrdersInterval);
            await browser.close();

          }

        }
    
        // Cleanup processedOrders set to avoid memory issues
        if (processedOrders.size > MAX_PROCESSED_ORDERS) {
          while (processedOrders.size > MAX_PROCESSED_ORDERS) {
            const oldestOrder = processedOrders.values().next().value;
            processedOrders.delete(oldestOrder);
          }
        }
      } catch (error) {
        setTimeout(() => {
            console.error('Fehler beim Abrufen der Bestellungen:', error);
          }, "60000");
          await sendLiveCheck(page, loggedIn = false);

      }
    }, 1000); // Alle Sekunde prüfen
    

    await sendLiveCheck(page);
}

try {
    main();

} catch (e) {
    console.log(e)
}

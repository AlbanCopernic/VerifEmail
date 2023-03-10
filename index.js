require('dotenv').config();
const express = require('express');
const request = require('request-promise-native');
const NodeCache = require('node-cache');
const session = require('express-session');
const bodyParser = require("body-parser");
const axios = require('axios');
const querystring = require('querystring');
const { write } = require('fs');
const app = express();
const { MongoClient, ServerApiVersion } = require('mongodb');


const PORT = process.env.PORT || 3000;

var refreshTokenStore = {};
const accessTokenCache = new NodeCache({ deleteOnExpire: true });

if (!process.env.CLIENT_ID || !process.env.CLIENT_SECRET) {
    throw new Error('Missing CLIENT_ID or CLIENT_SECRET environment variable.')
}

// const hubspotClient = new hubspot.Client();
// hubspotClient.oauth.tokensApi.createToken('refresh_token', undefined, undefined, process.env.CLIENT_ID, )

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

let SCOPES = ['crm.objects.contacts.read'];
if (process.env.SCOPE) {
  SCOPES = (process.env.SCOPE.split(/ |, ?|%20/)).join(' ');
}

const DOMAIN = process.env.DOMAIN

const REDIRECT_URI = `${DOMAIN}/oauth-callback`;

const MONGO_URI = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@cluster.ybsxrpr.mongodb.net/RefreshTokenEmailVerif?retryWrites=true&w=majority`

app.use(session({
  secret: Math.random().toString(36).substring(2),
  resave: false,
  saveUninitialized: true
}));
 
const authUrl =
  'https://app.hubspot.com/oauth/authorize' +
  `?client_id=${encodeURIComponent(CLIENT_ID)}` +
  `&scope=${encodeURIComponent(SCOPES)}` +
  `&redirect_uri=${REDIRECT_URI}`;
 

app.get('/install', (req, res) => {
  console.log('');
  console.log('=== Initiating OAuth 2.0 flow with HubSpot ===');
  console.log('');
  console.log("===> Step 1: Redirecting user to your app's OAuth URL");
  res.redirect(authUrl);
  console.log('===> Step 2: User is being prompted for consent by HubSpot');
});

app.get('/oauth-callback', async (req, res) => {
  console.log('===> Step 3: Handling the request sent by the server');

  if (req.query.code) {
    console.log('       > Received an authorization token');

    const authCodeProof = {
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      code: req.query.code
    };

    console.log('===> Step 4: Exchanging authorization code for an access token and refresh token');
    const token = await exchangeForTokens(req.sessionID, authCodeProof);
    if (token.message) {
      return res.redirect(`/error?msg=${token.message}`);
    }
    res.redirect(`/`);
  }
});

const exchangeForTokens = async (userId, exchangeProof) => {
  try {
    const responseBody = await request.post('https://api.hubapi.com/oauth/v1/token', {
      form: exchangeProof
    });
    const tokens = JSON.parse(responseBody);
    refreshTokenStore[userId] = tokens.refresh_token;
    accessTokenCache.set(userId, tokens.access_token, Math.round(tokens.expires_in * 0.75));
    console.log('       > Received an access token and refresh token');
    return tokens.access_token;
  } catch (e) {
    console.error(`       > Error exchanging ${exchangeProof.grant_type} for access token`);
    return JSON.parse(e.response.body);
  }
};

const refreshAccessToken = async (userId) => {
  const refreshTokenProof = {
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    refresh_token: refreshTokenStore[userId]
  };
  return await exchangeForTokens(userId, refreshTokenProof);
};

const getAccessToken = async (userId) => {
  if (!accessTokenCache.get(userId)) {
    console.log('Refreshing expired access token');
    await refreshAccessToken(userId);
  }
  return accessTokenCache.get(userId);
};

const isAuthorized = (userId) => {
  console.log("userId : "+ userId);
  console.log(refreshTokenStore);
  return refreshTokenStore[userId] ? true : false;
};

const getContact = async (accessToken) => {
  console.log('');
  console.log('=== Retrieving a contact from HubSpot using the access token ===');
  try {
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    };
    console.log('===> Replace the following request.get() to test other API calls');
    console.log('===> request.get(\'https://api.hubapi.com/contacts/v1/lists/all/contacts/all?count=1\')');
    const result = await request.get('https://api.hubapi.com/contacts/v1/lists/all/contacts/all?count=1', {
      headers: headers
    });

    return JSON.parse(result).contacts[0];
  } catch (e) {
    console.error('  > Unable to retrieve contact');
    return JSON.parse(e.response.body);
  }
};

const displayContactName = (res, contact) => {
  if (contact.status === 'error') {
    res.write(`<p>Unable to retrieve contact! Error Message: ${contact.message}</p>`);
    return;
  }
  const { firstname, lastname } = contact.properties;
  res.write(`<p>Contact name: ${firstname.value} ${lastname.value}</p>`);
};

const getNewAccessToken = async (req) => {
  
  const authCodeProof = {
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    code: req.query.code
  };
  try {
    const requestBody = await axios.post('https://api.hubspot.com/oauth/v1/token', querystring.stringify(authCodeProof))
    console.log(`access token : ${requestBody.data.accessToken}`)
    accessTokenCache.set(req.sessionID, requestBody.data.access_token, Math.round(tokens.expires_in * 0.75));
  } catch (error) {
    console.error(error)
  }
}

async function writeToken(portalId) {
  console.log("uri : "+ MONGO_URI)
  const client = new MongoClient(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });
  console.log("envoi des infos")
  MongoClient.connect(uri).then(async (client) => {
    await client.db("RefreshTokenEmailVerif").collection("tokenInfo").insertOne({ portalId: portalId, refreshToken: refreshTokenStore[portalId]});
    console.log("succ??s")
    client.close()
  }).catch(err => {
    console.log(err);
  });
}

async function readToken() {
  
}

app.get('/', async (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.write(`<h2>HubSpot OAuth 2.0 Quickstart App</h2>`);
  if (isAuthorized(req.sessionID)) {
    const accessToken = await getAccessToken(req.sessionID);
    // const contact = await getContact(accessToken);
    res.write(`<h4>Access token: ${accessToken}</h4>`);
    // displayContactName(res, contact);
    await writeToken(req.sessionID)
  } else {
    res.write(`<a href="/install"><h3>Install the app</h3></a>`);
  }
  res.end();
});

app.get('/write', async (req, res) => {
  var truc = await writeToken();
  console.log(truc);
  res.write('<p>gg</p>');
  res.end();
})

app.get('/read', (req, res) => {
  readToken();
  res.write('truc2');
})

app.get('/error', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.write(`<h4>Error: ${req.query.msg}</h4>`);
  res.end();
});

app.use(bodyParser.json())

app.post('/post', async (req, res) => {
    res.status(200).end()
    req.body.forEach(element => {
      if (!isAuthorized(req.sessionID)) {
        getNewAccessToken(req)
      }
      switch(element.subscriptionType) {
        case 'contact.propertyChange':
          console.log('propertyChange');
          axios.get('https://api.captainverify.com/verify?phone=+33000000000&apikey=HKfoSrOjBmk1pLhAcXuxOiD0tvgts24a').then(function (response) {
            
          }).catch(function (error) {
            console.error(error);
          });
        break;
        default:
          break;
      }
    })
});

app.listen(PORT, () => console.log(`=== Listening on port : ${PORT} ===`));
// opn(DOMAIN);

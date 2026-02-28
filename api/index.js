// Vercel serverless function for API routes
// This file handles API requests by forwarding them to the Express server

const { createServer } = require('http');
const express = require('express');

// Import the built Express app
// Note: This requires the server to be modified to export the app
// For now, we'll create a simple handler

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Import routes from the built server
// This is a placeholder - actual implementation would require
// restructuring the server code to work with Vercel serverless functions

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'API is running' });
});

// Export the handler for Vercel
module.exports = (req, res) => {
    app(req, res);
};

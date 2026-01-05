const fs = require('fs');
const path = require('path');

// Try to load dotenv if available, for Node execution
try {
  require('dotenv').config({ path: '.env.local' });
  require('dotenv').config({ path: '.env' });
} catch (e) {
  // Ignore
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.error("\x1b[31m❌ Error: GEMINI_API_KEY not found in environment variables.\x1b[0m");
    console.log("If running with Node, make sure 'dotenv' is installed and .env.local exists.");
    console.log("If running with Bun, it should load .env automatically.");
    process.exit(1);
  }

  console.log(`\x1b[36m🔍 Checking available models for API Key: ${apiKey.substring(0, 8)}...\x1b[0m`);

  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

  try {
    const response = await fetch(url);
    
    if (!response.ok) {
      console.error(`\x1b[31m❌ HTTP Error: ${response.status} ${response.statusText}\x1b[0m`);
      const text = await response.text();
      console.error("Response body:", text);
      return;
    }

    const data = await response.json();

    if (!data.models) {
      console.log("No models property in response.");
      return;
    }

    // Filter for "flash" models
    const flashModels = data.models.filter(m => m.name.toLowerCase().includes('flash'));
    const allModels = data.models;

    console.log(`\n\x1b[32m✅ Found ${allModels.length} total models.\x1b[0m`);
    console.log(`\x1b[33m⚡ Showing 'flash' models:\x1b[0m\n`);

    flashModels.forEach(model => {
      // name is usually "models/model-id"
      const id = model.name.replace('models/', '');
      console.log(`\x1b[1mID: ${id}\x1b[0m (Full: ${model.name})`);
      console.log(`Name: ${model.displayName}`);
      console.log(`Desc: ${model.description ? model.description.substring(0, 80) + '...' : 'No description'}`);
      console.log('\x1b[90m' + '-'.repeat(50) + '\x1b[0m');
    });

    console.log("\n\x1b[33m📋 Valid IDs for your code often look like:\x1b[0m");
    flashModels.slice(0, 3).forEach(m => console.log(`- "${m.name.replace('models/', '')}"`));

  } catch (error) {
    console.error("\x1b[31m❌ Failed to fetch models:\x1b[0m", error);
  }
}

main();

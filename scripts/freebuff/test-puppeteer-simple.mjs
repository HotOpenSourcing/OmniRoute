#!/usr/bin/env node
/**
 * Test simple de Puppeteer
 */

import puppeteer from "puppeteer";

async function testSimple() {
  console.log("Testing Puppeteer launch...\n");
  
  try {
    console.log("Launching browser...");
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox'],
    });
    
    console.log("✅ Browser launched successfully!");
    
    const page = await browser.newPage();
    console.log("✅ Page created!");
    
    await page.goto("https://example.com");
    console.log("✅ Navigation successful!");
    
    await browser.close();
    console.log("✅ All tests passed!");
    
  } catch (error) {
    console.error("❌ Error:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testSimple();

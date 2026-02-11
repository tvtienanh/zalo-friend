/**
 * ZALO PROXY SERVER - Node.js + Puppeteer
 * Deploy lên Heroku/Vercel/Railway để bypass Zalo login
 * 
 * CÁCH CÀI ĐẶT:
 * 1. npm init -y
 * 2. npm install express puppeteer
 * 3. node server.js
 * 4. Deploy lên Heroku hoặc Railway
 */

const express = require('express');
const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');

const app = express();
const PORT = process.env.PORT || 3000;

// Cache để giảm số lần scrape
const cache = new Map();
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 giờ

// Middleware CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// Endpoint check Zalo
app.get('/api/zalo', async (req, res) => {
  const phone = req.query.phone;
  
  if (!phone) {
    return res.status(400).json({ error: 'Missing phone parameter' });
  }
  
  // Chuẩn hóa số điện thoại
  const cleanPhone = phone.toString().trim().replace(/\s/g, '').replace(/\+84/, '0');
  
  // Kiểm tra cache
  const cacheKey = `zalo_${cleanPhone}`;
  const cached = cache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`Cache hit for ${cleanPhone}`);
    return res.json(cached.data);
  }
  
  try {
    console.log(`Scraping Zalo for ${cleanPhone}...`);
    
const browser = await puppeteer.launch({
  args: chromium.args,
  defaultViewport: chromium.defaultViewport,
  executablePath: await chromium.executablePath(),
  headless: chromium.headless,
});

    
    const page = await browser.newPage();
    
    // Set user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Navigate to Zalo profile
    const url = `https://zalo.me/${cleanPhone}`;
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 10000 });
    
    // Wait a bit for dynamic content
    await page.waitForTimeout(2000);
    
    // Extract name from multiple possible selectors
    const result = await page.evaluate(() => {
      // Try multiple selectors
      const selectors = [
        'h1.main__name',
        '.main__name',
        '.card-name',
        'h1[class*="name"]',
        '[data-name]'
      ];
      
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element && element.textContent.trim()) {
          return {
            name: element.textContent.trim(),
            status: 'Tồn tại'
          };
        }
      }
      
      // Check for error messages
      const body = document.body.innerHTML;
      if (body.includes('Tài khoản này không tồn tại') || 
          body.includes('không cho phép tìm kiếm')) {
        return {
          name: '',
          status: 'Không tồn tại'
        };
      }
      
      // Try to get from meta tags
      const metaTitle = document.querySelector('meta[property="og:title"]');
      if (metaTitle) {
        const title = metaTitle.getAttribute('content');
        if (title && !title.includes('Zalo') && title.length > 0) {
          return {
            name: title.replace(/\s*-\s*Zalo\s*$/i, ''),
            status: 'Tồn tại'
          };
        }
      }
      
      return {
        name: '',
        status: 'Không xác định'
      };
    });
    
    await browser.close();
    
    const response = {
      phone: cleanPhone,
      name: result.name || '',
      status: result.status || 'Không xác định',
      timestamp: new Date().toISOString()
    };
    
    // Lưu cache
    cache.set(cacheKey, {
      data: response,
      timestamp: Date.now()
    });
    
    console.log(`Result for ${cleanPhone}:`, response);
    res.json(response);
    
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({
      phone: cleanPhone,
      name: '',
      status: 'Lỗi',
      error: error.message
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', cache_size: cache.size });
});

// Clear cache endpoint
app.post('/cache/clear', (req, res) => {
  cache.clear();
  res.json({ message: 'Cache cleared', cache_size: 0 });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Zalo Proxy Server running on port ${PORT}`);
  console.log(`📍 API Endpoint: http://localhost:${PORT}/api/zalo?phone=0398981698`);
});

// Clear old cache every hour
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of cache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      cache.delete(key);
    }
  }
  console.log(`🧹 Cache cleaned. Current size: ${cache.size}`);
}, 60 * 60 * 1000);

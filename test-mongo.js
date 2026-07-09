require('dotenv').config();
const dns = require('dns');
const mongoose = require('mongoose');

// Force Google DNS for all lookups
dns.setServers(['8.8.8.8', '8.8.4.4']);

console.log('Using DNS servers:', dns.getServers());

mongoose.connect(process.env.MONGO_URL)
  .then(() => {
    console.log('✅ MongoDB Connected Successfully');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ MongoDB Connection Error:', err.message);
    process.exit(1);
  });
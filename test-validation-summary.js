/**
 * Test script to demonstrate the inline validation summary feature
 * This script simulates uploading a file and shows the validation summary response
 */

const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

async function testValidationSummary() {
  console.log('🧪 Testing Inline Validation Summary (M-2)');
  console.log('='.repeat(50));

  // Path to test file
  const testFilePath = path.join(__dirname, 'data', 'uploads', '2025-11-10-AMD.xlsx');
  
  if (!fs.existsSync(testFilePath)) {
    console.log('❌ Test file not found:', testFilePath);
    return;
  }

  try {
    // Create form data
    const form = new FormData();
    form.append('file', fs.createReadStream(testFilePath));
    form.append('symbol', 'AMD');
    form.append('exchange', 'NASDAQ');

    console.log('📤 Uploading file to enhanced API...');
    console.log(`File: ${path.basename(testFilePath)}`);
    console.log(`Symbol: AMD`);
    console.log('');

    // Make request to enhanced upload API
    const response = await fetch('http://localhost:3001/api/upload/enhanced', {
      method: 'POST',
      body: form
    });

    const data = await response.json();

    if (response.ok && data.ok) {
      console.log('✅ Upload successful! Validation summary:');
      console.log('');
      
      // Display file info
      console.log('📁 File Information:');
      console.log(`  Name: ${data.file.name}`);
      console.log(`  Rows: ${data.file.rows.toLocaleString()}`);
      console.log(`  Size: ${(data.file.sizeBytes / 1024).toFixed(1)} KB`);
      console.log(`  Hash: ${data.file.hash.substring(0, 16)}...`);
      console.log('');

      // Display date range
      console.log('📅 Date Range:');
      console.log(`  From: ${data.dateRange.first}`);
      console.log(`  To: ${data.dateRange.last}`);
      console.log('');

      // Display validation badges
      console.log('🔍 Validation Results:');
      console.log(`  OHLC Coherence: ${data.validation.ohlcCoherence.failCount === 0 ? '✅ Pass' : '❌ ' + data.validation.ohlcCoherence.failCount + ' fails'}`);
      console.log(`  Missing Days: ${data.validation.missingDays.totalMissing} total, ${data.validation.missingDays.consecutiveMax} max consecutive`);
      console.log(`  Data Quality: ${data.validation.missingDays.blocked ? '🚫 BLOCKED - Too many missing days' : '✅ Good'}`);
      console.log(`  Duplicates: ${data.validation.duplicates.count} found`);
      console.log(`  Corporate Actions: ${data.validation.corporateActions.splits} splits, ${data.validation.corporateActions.dividends} dividends`);
      console.log(`  Outliers: ${data.validation.outliers.flagged} flagged`);
      console.log('');

      // Display provenance
      console.log('🔗 Provenance:');
      console.log(`  Vendor: ${data.provenance.vendor}`);
      console.log(`  Mapping ID: ${data.provenance.mappingId}`);
      console.log(`  Processed: ${new Date(data.provenance.processedAt).toLocaleString()}`);
      console.log('');

      // Show blocking status
      if (data.validation.missingDays.blocked) {
        console.log('⚠️  DOWNSTREAM ANALYSIS BLOCKED');
        console.log(`   Reason: Too many missing days (${data.validation.missingDays.totalMissing} > ${data.validation.missingDays.thresholds.maxTotal})`);
        console.log('   GBM and volatility forecasts will be disabled');
      } else {
        console.log('🎯 READY FOR ANALYSIS');
        console.log('   GBM and volatility forecasts can proceed');
      }

    } else {
      console.log('❌ Upload failed:', data.error || 'Unknown error');
    }

  } catch (error) {
    console.log('❌ Test error:', error.message);
  }

  console.log('');
  console.log('='.repeat(50));
  console.log('✨ Test completed! Check the UI at http://localhost:3001/company/AMD/timing');
}

// Only run if called directly (not imported)
if (require.main === module) {
  testValidationSummary();
}

module.exports = { testValidationSummary };
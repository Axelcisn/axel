// Quick debug script to test the target spec API
const { getTargetSpec } = require('./lib/storage/targetSpecStore.ts');

async function testTargetSpec() {
  try {
    console.log('Testing getTargetSpec directly...');
    const result = await getTargetSpec('AAPL');
    console.log('Direct result:', result);
    
    if (result) {
      console.log('Wrapped result (API format):');
      const apiResponse = {
        spec: result,
        meta: {
          hasTZ: !!result.exchange_tz,
          source: "canonical"
        }
      };
      console.log(JSON.stringify(apiResponse, null, 2));
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

testTargetSpec();
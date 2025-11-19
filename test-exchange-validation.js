async function testExchangeValidation() {
  try {
    const response = await fetch('http://localhost:3001/api/exchange/validate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ticker: 'BHP',
        exchange: 'NASDAQ'
      })
    });
    
    const data = await response.json();
    console.log('Response:', JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Test error:', error.message);
  }
}

testExchangeValidation();
'use client';

import { useState } from 'react';
import { parseCSV, validateCSVHeaders, generateSampleCSV, StockData } from '@/lib/csvUtils';
import { analyzePortfolio, AnalysisResult, formatCurrency, formatPercent, getRiskLevel, getDiversificationLevel } from '@/lib/analysis';

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [csvData, setCsvData] = useState<StockData[]>([]);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile && selectedFile.type === 'text/csv') {
      setFile(selectedFile);
      setError('');
    } else {
      setError('Please select a valid CSV file');
      setFile(null);
    }
  };

  const handleUpload = async () => {
    if (!file) {
      setError('Please select a file first');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const text = await file.text();
      
      if (!validateCSVHeaders(text)) {
        throw new Error('Invalid CSV format. Required columns: Symbol/Ticker, Price');
      }

      const parsedData = parseCSV(text);
      if (parsedData.length === 0) {
        throw new Error('No valid data found in CSV file');
      }

      setCsvData(parsedData);
      const analysisResult = analyzePortfolio(parsedData);
      setAnalysis(analysisResult);
      
      // Save to localStorage for watchlist
      localStorage.setItem('portfolioData', JSON.stringify(parsedData));
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error processing file');
    } finally {
      setIsLoading(false);
    }
  };

  const downloadSample = () => {
    const csvContent = generateSampleCSV();
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'sample_portfolio.csv';
    link.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4">
        <div className="bg-white rounded-lg shadow-lg p-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">Portfolio Upload & Analysis</h1>
          
          {/* Upload Section */}
          <div className="mb-8">
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
              <div className="mb-4">
                <svg className="mx-auto h-12 w-12 text-gray-400" stroke="currentColor" fill="none" viewBox="0 0 48 48">
                  <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <input
                type="file"
                accept=".csv"
                onChange={handleFileChange}
                className="hidden"
                id="csv-upload"
              />
              <label
                htmlFor="csv-upload"
                className="cursor-pointer inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
              >
                Choose CSV File
              </label>
              {file && (
                <p className="mt-2 text-sm text-gray-600">
                  Selected: {file.name}
                </p>
              )}
            </div>
            
            <div className="mt-4 flex justify-between items-center">
              <button
                onClick={handleUpload}
                disabled={!file || isLoading}
                className="px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {isLoading ? 'Processing...' : 'Upload & Analyze'}
              </button>
              
              <button
                onClick={downloadSample}
                className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
              >
                Download Sample CSV
              </button>
            </div>
            
            {error && (
              <div className="mt-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
                {error}
              </div>
            )}
          </div>

          {/* Analysis Results */}
          {analysis && (
            <div className="space-y-6">
              <h2 className="text-2xl font-semibold text-gray-900">Portfolio Analysis</h2>
              
              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-blue-50 p-4 rounded-lg">
                  <h3 className="text-sm font-medium text-blue-600">Total Stocks</h3>
                  <p className="text-2xl font-bold text-blue-900">{analysis.totalStocks}</p>
                </div>
                <div className="bg-green-50 p-4 rounded-lg">
                  <h3 className="text-sm font-medium text-green-600">Average Price</h3>
                  <p className="text-2xl font-bold text-green-900">{formatCurrency(analysis.avgPrice)}</p>
                </div>
                <div className="bg-purple-50 p-4 rounded-lg">
                  <h3 className="text-sm font-medium text-purple-600">Risk Level</h3>
                  <p className="text-2xl font-bold text-purple-900">{getRiskLevel(analysis.riskScore)}</p>
                </div>
                <div className="bg-yellow-50 p-4 rounded-lg">
                  <h3 className="text-sm font-medium text-yellow-600">Diversification</h3>
                  <p className="text-2xl font-bold text-yellow-900">{getDiversificationLevel(analysis.diversificationScore)}</p>
                </div>
              </div>

              {/* Top Performers */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Top Gainers */}
                <div className="bg-green-50 p-6 rounded-lg">
                  <h3 className="text-lg font-semibold text-green-800 mb-4">Top Gainers</h3>
                  <div className="space-y-2">
                    {analysis.topGainers.map((stock, index) => (
                      <div key={index} className="flex justify-between items-center">
                        <span className="font-medium">{stock.symbol}</span>
                        <span className="text-green-600">{formatPercent(stock.changePercent)}</span>
                      </div>
                    ))}
                    {analysis.topGainers.length === 0 && (
                      <p className="text-gray-500">No gainers found</p>
                    )}
                  </div>
                </div>

                {/* Top Losers */}
                <div className="bg-red-50 p-6 rounded-lg">
                  <h3 className="text-lg font-semibold text-red-800 mb-4">Top Losers</h3>
                  <div className="space-y-2">
                    {analysis.topLosers.map((stock, index) => (
                      <div key={index} className="flex justify-between items-center">
                        <span className="font-medium">{stock.symbol}</span>
                        <span className="text-red-600">{formatPercent(stock.changePercent)}</span>
                      </div>
                    ))}
                    {analysis.topLosers.length === 0 && (
                      <p className="text-gray-500">No losers found</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Portfolio Table */}
              <div className="bg-white border rounded-lg overflow-hidden">
                <h3 className="text-lg font-semibold p-4 bg-gray-50 border-b">Portfolio Holdings</h3>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Symbol</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Price</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Change</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Change %</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Volume</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {csvData.slice(0, 10).map((stock, index) => (
                        <tr key={index}>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{stock.symbol}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{formatCurrency(stock.price)}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{formatCurrency(stock.change)}</td>
                          <td className={`px-6 py-4 whitespace-nowrap text-sm ${stock.changePercent >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {formatPercent(stock.changePercent)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{stock.volume.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {csvData.length > 10 && (
                  <div className="p-4 bg-gray-50 text-center text-sm text-gray-600">
                    Showing first 10 of {csvData.length} stocks
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
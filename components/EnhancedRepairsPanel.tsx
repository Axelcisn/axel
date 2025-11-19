/**
 * Enhanced Repairs and Provenance Panel Component
 * Shows comprehensive audit trail and data quality information
 */

'use client';

import { useState, useEffect } from 'react';

interface ProvenanceRecord {
  id: string;
  symbol: string;
  uploadedAt: string;
  fileInfo: {
    originalName: string;
    fileHash: string;
    sizeBytes: number;
  };
  vendor: {
    name: string;
    detectedFrom: string;
    confidence: number;
  };
  processing: {
    headerMappings: Record<string, string>;
    rowsProcessed: number;
    rowsAccepted: number;
    rowsRejected: number;
    dateRange: { start: string; end: string };
  };
  validation: {
    validationPassed: boolean;
    warnings: string[];
    errors: string[];
    qualityScore: number;
  };
  transformations: {
    appliedRepairs: number;
    computedFields: string[];
    normalizations: string[];
  };
}

interface AuditSummary {
  symbol: string;
  totalUploads: number;
  dateRange: { start: string; end: string };
  dataQuality: {
    averageQualityScore: number;
    totalRepairs: number;
    commonIssues: Array<{ issue: string; count: number }>;
  };
  vendors: Array<{ vendor: string; uploads: number; lastUpload: string }>;
  recentActivity: ProvenanceRecord[];
}

interface EnhancedRepairsPanelProps {
  symbol: string;
  isOpen: boolean;
  onClose: () => void;
}

export function EnhancedRepairsPanel({ symbol, isOpen, onClose }: EnhancedRepairsPanelProps) {
  const [auditSummary, setAuditSummary] = useState<AuditSummary | null>(null);
  const [selectedUpload, setSelectedUpload] = useState<ProvenanceRecord | null>(null);
  const [activeTab, setActiveTab] = useState<'summary' | 'uploads' | 'details'>('summary');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && symbol) {
      loadAuditData();
    }
  }, [isOpen, symbol]); // loadAuditData is defined inside this component and doesn't need to be in dependencies

  const loadAuditData = async () => {
    setLoading(true);
    try {
      // This would call your API to get audit summary
      const response = await fetch(`/api/audit/summary?symbol=${symbol}`);
      if (response.ok) {
        const data = await response.json();
        setAuditSummary(data);
      }
    } catch (error) {
      console.error('Failed to load audit data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (isoString: string) => {
    return new Date(isoString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getQualityBadgeColor = (score: number) => {
    if (score >= 90) return 'bg-green-100 text-green-800';
    if (score >= 70) return 'bg-yellow-100 text-yellow-800';
    return 'bg-red-100 text-red-800';
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg max-w-6xl w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="bg-gray-50 px-6 py-4 border-b">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">
                Data Audit & Provenance: {symbol}
              </h2>
              <p className="text-sm text-gray-600">
                Comprehensive data quality and processing history
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-xl"
            >
              ×
            </button>
          </div>
          
          {/* Tabs */}
          <div className="flex space-x-4 mt-4">
            {(['summary', 'uploads', 'details'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 rounded-md text-sm font-medium ${
                  activeTab === tab
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab === 'summary' ? 'Overview' : 
                 tab === 'uploads' ? 'Upload History' : 'Details'}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[70vh]">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : (
            <>
              {/* Summary Tab */}
              {activeTab === 'summary' && auditSummary && (
                <div className="space-y-6">
                  {/* Key Metrics */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-blue-50 p-4 rounded-lg">
                      <div className="text-2xl font-bold text-blue-600">
                        {auditSummary.totalUploads}
                      </div>
                      <div className="text-sm text-gray-600">Total Uploads</div>
                    </div>
                    <div className="bg-green-50 p-4 rounded-lg">
                      <div className="text-2xl font-bold text-green-600">
                        {auditSummary.dataQuality.averageQualityScore.toFixed(0)}%
                      </div>
                      <div className="text-sm text-gray-600">Avg Quality</div>
                    </div>
                    <div className="bg-yellow-50 p-4 rounded-lg">
                      <div className="text-2xl font-bold text-yellow-600">
                        {auditSummary.dataQuality.totalRepairs}
                      </div>
                      <div className="text-sm text-gray-600">Total Repairs</div>
                    </div>
                    <div className="bg-purple-50 p-4 rounded-lg">
                      <div className="text-2xl font-bold text-purple-600">
                        {auditSummary.vendors.length}
                      </div>
                      <div className="text-sm text-gray-600">Data Vendors</div>
                    </div>
                  </div>

                  {/* Data Range */}
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <h3 className="font-semibold mb-2">Data Coverage</h3>
                    <p className="text-gray-600">
                      {auditSummary.dateRange.start} to {auditSummary.dateRange.end}
                    </p>
                  </div>

                  {/* Common Issues */}
                  <div>
                    <h3 className="font-semibold mb-3">Common Data Issues</h3>
                    <div className="space-y-2">
                      {auditSummary.dataQuality.commonIssues.slice(0, 5).map((issue, idx) => (
                        <div key={idx} className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded">
                          <span className="text-sm text-gray-700">{issue.issue}</span>
                          <span className="text-sm font-medium text-gray-900">{issue.count}x</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Vendors */}
                  <div>
                    <h3 className="font-semibold mb-3">Data Vendors</h3>
                    <div className="space-y-2">
                      {auditSummary.vendors.map((vendor, idx) => (
                        <div key={idx} className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded">
                          <div>
                            <span className="text-sm font-medium text-gray-900">{vendor.vendor}</span>
                            <span className="text-xs text-gray-500 ml-2">
                              Last: {formatDate(vendor.lastUpload)}
                            </span>
                          </div>
                          <span className="text-sm text-gray-600">{vendor.uploads} uploads</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Upload History Tab */}
              {activeTab === 'uploads' && auditSummary && (
                <div className="space-y-4">
                  <h3 className="font-semibold">Recent Upload History</h3>
                  <div className="space-y-3">
                    {auditSummary.recentActivity.map((upload) => (
                      <div 
                        key={upload.id}
                        className="border rounded-lg p-4 hover:bg-gray-50 cursor-pointer"
                        onClick={() => setSelectedUpload(upload)}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-medium">{upload.fileInfo.originalName}</div>
                            <div className="text-sm text-gray-600">
                              {formatDate(upload.uploadedAt)} • {upload.vendor.name}
                            </div>
                          </div>
                          <div className="flex items-center space-x-2">
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                              getQualityBadgeColor(upload.validation.qualityScore)
                            }`}>
                              {upload.validation.qualityScore}% Quality
                            </span>
                            <div className="text-sm text-gray-500">
                              {upload.processing.rowsAccepted} rows
                            </div>
                          </div>
                        </div>
                        
                        {/* Quick stats */}
                        <div className="mt-2 flex items-center space-x-4 text-xs text-gray-500">
                          <span>{formatFileSize(upload.fileInfo.sizeBytes)}</span>
                          <span>{upload.processing.dateRange.start} to {upload.processing.dateRange.end}</span>
                          {upload.transformations.appliedRepairs > 0 && (
                            <span className="text-yellow-600">
                              {upload.transformations.appliedRepairs} repairs
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Details Tab */}
              {activeTab === 'details' && selectedUpload && (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">Upload Details</h3>
                    <button 
                      onClick={() => setSelectedUpload(null)}
                      className="text-blue-600 text-sm hover:underline"
                    >
                      ← Back to list
                    </button>
                  </div>

                  {/* File Info */}
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <h4 className="font-medium mb-2">File Information</h4>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-gray-600">Filename:</span>
                        <div className="font-mono">{selectedUpload.fileInfo.originalName}</div>
                      </div>
                      <div>
                        <span className="text-gray-600">Size:</span>
                        <div>{formatFileSize(selectedUpload.fileInfo.sizeBytes)}</div>
                      </div>
                      <div>
                        <span className="text-gray-600">Hash:</span>
                        <div className="font-mono text-xs">{selectedUpload.fileInfo.fileHash.substring(0, 16)}...</div>
                      </div>
                      <div>
                        <span className="text-gray-600">Uploaded:</span>
                        <div>{formatDate(selectedUpload.uploadedAt)}</div>
                      </div>
                    </div>
                  </div>

                  {/* Processing Stats */}
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <h4 className="font-medium mb-2">Processing Statistics</h4>
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <span className="text-gray-600">Rows Processed:</span>
                        <div className="font-medium">{selectedUpload.processing.rowsProcessed}</div>
                      </div>
                      <div>
                        <span className="text-gray-600">Rows Accepted:</span>
                        <div className="font-medium text-green-600">{selectedUpload.processing.rowsAccepted}</div>
                      </div>
                      <div>
                        <span className="text-gray-600">Rows Rejected:</span>
                        <div className="font-medium text-red-600">{selectedUpload.processing.rowsRejected}</div>
                      </div>
                    </div>
                  </div>

                  {/* Header Mappings */}
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <h4 className="font-medium mb-2">Header Mappings</h4>
                    <div className="space-y-1 text-sm">
                      {Object.entries(selectedUpload.processing.headerMappings).map(([source, target]) => (
                        <div key={source} className="flex items-center justify-between">
                          <span className="text-gray-600">{source}</span>
                          <span className="font-mono">→</span>
                          <span className="font-medium">{target}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Warnings & Errors */}
                  {(selectedUpload.validation.warnings.length > 0 || selectedUpload.validation.errors.length > 0) && (
                    <div className="space-y-4">
                      {selectedUpload.validation.errors.length > 0 && (
                        <div className="bg-red-50 p-4 rounded-lg">
                          <h4 className="font-medium text-red-800 mb-2">Errors</h4>
                          <ul className="text-sm text-red-700 space-y-1">
                            {selectedUpload.validation.errors.map((error, idx) => (
                              <li key={idx}>• {error}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      
                      {selectedUpload.validation.warnings.length > 0 && (
                        <div className="bg-yellow-50 p-4 rounded-lg">
                          <h4 className="font-medium text-yellow-800 mb-2">Warnings</h4>
                          <ul className="text-sm text-yellow-700 space-y-1">
                            {selectedUpload.validation.warnings.map((warning, idx) => (
                              <li key={idx}>• {warning}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
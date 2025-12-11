'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { CompanyInfo } from '@/lib/types/company';
import { useDarkMode } from '@/lib/hooks/useDarkMode';

interface FileInfo {
  name: string;
  type: 'canonical' | 'upload' | 'forecast' | 'spec' | 'audit';
  size?: string;
  lastModified: string;
  path: string;
  deleted?: boolean;
}

interface CompanyFolderData {
  company: CompanyInfo;
  files: FileInfo[];
}

export default function CompanyFolderPage() {
  const params = useParams();
  const router = useRouter();
  const ticker = params.ticker as string;
  const isDarkMode = useDarkMode();
  
  const [data, setData] = useState<CompanyFolderData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const [sortBy, setSortBy] = useState<'name' | 'type' | 'lastModified'>('type');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [fileToDelete, setFileToDelete] = useState<FileInfo | null>(null);
  const [deleting, setDeleting] = useState(false);
  const headingColor = isDarkMode ? 'text-white' : 'text-gray-900';
  const mutedText = isDarkMode ? 'text-slate-300' : 'text-gray-600';
  const labelColor = isDarkMode ? 'text-slate-200' : 'text-gray-700';
  const cardSurface = isDarkMode ? 'bg-slate-900/60 border border-slate-800' : 'bg-white border border-gray-200';
  const gridCardSurface = isDarkMode ? 'bg-slate-900/60 border border-slate-800/80' : 'bg-white border border-gray-200';
  const STORAGE_KEY = 'axel:memory:deleted';

  const getDeletedFilesForTicker = () => {
    if (typeof window === 'undefined') return new Set<string>();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
      return new Set(parsed[ticker] || []);
    } catch {
      return new Set<string>();
    }
  };

  const persistDeletedFile = (name: string) => {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
      const existing = new Set(parsed[ticker] || []);
      existing.add(name);
      parsed[ticker] = Array.from(existing);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (ticker) {
      loadCompanyFolderData();
    }
  }, [ticker]);

  const loadCompanyFolderData = async () => {
    setLoading(true);
    setError(null);

    try {
      // Load company info first (required)
      const companyResponse = await fetch(`/api/companies?ticker=${ticker}`);
      if (!companyResponse.ok) {
        throw new Error('Company not found');
      }
      const company = await companyResponse.json();

      // Fetch all file types in parallel
      const [canonicalResult, uploadsResult, specResult, forecastResult] = await Promise.allSettled([
        fetch(`/api/canonical/${ticker}`),
        fetch(`/api/upload?ticker=${ticker}`),
        fetch(`/api/target-spec/${ticker}`),
        fetch(`/api/forecast/gbm/${ticker}`)
      ]);

      const deleted = getDeletedFilesForTicker();
      const files: FileInfo[] = [];

      // Process canonical data
      if (canonicalResult.status === 'fulfilled' && canonicalResult.value.ok) {
        try {
          const canonicalData = await canonicalResult.value.json();
          if (canonicalData.meta) {
            files.push({
              name: `${ticker}.json`,
              type: 'canonical',
              size: `${canonicalData.meta.rows || 0} rows`,
              lastModified: canonicalData.meta.generated_at || new Date().toISOString(),
              path: `/api/canonical/${ticker}`
            });
          }
        } catch (e) {
          console.log('Error parsing canonical data');
        }
      }

      // Process uploads
      if (uploadsResult.status === 'fulfilled' && uploadsResult.value.ok) {
        try {
          const uploadsData = await uploadsResult.value.json();
          if (uploadsData.hasUploads && uploadsData.files) {
            uploadsData.files.forEach((fileName: string) => {
              files.push({
                name: fileName,
                type: 'upload',
                size: 'Excel/CSV file',
                lastModified: new Date().toISOString(),
                path: `/data/uploads/${fileName}`
              });
            });
          }
        } catch (e) {
          console.log('Error parsing uploads data');
        }
      }

      // Process target specs
      if (specResult.status === 'fulfilled' && specResult.value.ok) {
        files.push({
          name: `${ticker}-target-spec.json`,
          type: 'spec',
          size: 'Target specification',
          lastModified: new Date().toISOString(),
          path: `/api/target-spec/${ticker}`
        });
      }

      // Process forecasts
      if (forecastResult.status === 'fulfilled' && forecastResult.value.ok) {
        files.push({
          name: `${ticker}-gbm-forecast.json`,
          type: 'forecast',
          size: 'GBM forecast data',
          lastModified: new Date().toISOString(),
          path: `/api/forecast/gbm/${ticker}`
        });
      }

      const filtered = files.filter((file) => !deleted.has(file.name));
      setData({ company, files: filtered });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const sortedFiles = [...(data?.files || [])].sort((a, b) => {
    let aValue: string | number = '';
    let bValue: string | number = '';

    switch (sortBy) {
      case 'name':
        aValue = a.name;
        bValue = b.name;
        break;
      case 'type':
        aValue = a.type;
        bValue = b.type;
        break;
      case 'lastModified':
        aValue = new Date(a.lastModified).getTime();
        bValue = new Date(b.lastModified).getTime();
        break;
    }

    if (typeof aValue === 'string' && typeof bValue === 'string') {
      return sortDirection === 'asc' 
        ? aValue.localeCompare(bValue)
        : bValue.localeCompare(aValue);
    }

    return sortDirection === 'asc' 
      ? (aValue as number) - (bValue as number)
      : (bValue as number) - (aValue as number);
  });

  const getFileIcon = (type: string) => {
    switch (type) {
      case 'canonical':
        return (
          <svg className="h-8 w-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        );
      case 'upload':
        return (
          <svg className="h-8 w-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        );
      case 'forecast':
        return (
          <svg className="h-8 w-8 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        );
      case 'spec':
        return (
          <svg className="h-8 w-8 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4" />
          </svg>
        );
      case 'audit':
        return (
          <svg className="h-8 w-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        );
      default:
        return (
          <svg className="h-8 w-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        );
    }
  };

  const getFileTypeLabel = (type: string) => {
    switch (type) {
      case 'canonical': return 'Historical Data';
      case 'upload': return 'Uploaded File';
      case 'forecast': return 'Forecast Data';
      case 'spec': return 'Target Specification';
      case 'audit': return 'Audit Record';
      default: return 'Unknown';
    }
  };

  const getFileTypeColor = (type: string, darkMode: boolean) => {
    if (darkMode) {
      switch (type) {
        case 'canonical': return 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30';
        case 'upload': return 'bg-blue-500/15 text-blue-200 ring-1 ring-blue-500/30';
        case 'forecast': return 'bg-purple-500/20 text-purple-200 ring-1 ring-purple-500/30';
        case 'spec': return 'bg-amber-400/20 text-amber-200 ring-1 ring-amber-400/30';
        case 'audit': return 'bg-red-500/20 text-red-200 ring-1 ring-red-500/30';
        default: return 'bg-slate-500/20 text-slate-200 ring-1 ring-slate-500/30';
      }
    }

    switch (type) {
      case 'canonical': return 'bg-green-100 text-green-800';
      case 'upload': return 'bg-blue-100 text-blue-800';
      case 'forecast': return 'bg-purple-100 text-purple-800';
      case 'spec': return 'bg-yellow-100 text-yellow-800';
      case 'audit': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const handleSort = (field: 'name' | 'type' | 'lastModified') => {
    if (sortBy === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortDirection('asc');
    }
  };

  const handleFileClick = (file: FileInfo) => {
    if (file.deleted) {
      // If file is deleted, show upload option
      handleUpload(file);
      return;
    }

    if (file.type === 'canonical' || file.type === 'forecast' || file.type === 'spec') {
      // Open in edit mode - we'll create a simple JSON editor
      openFileEditor(file);
    } else if (file.type === 'upload') {
      // For uploads, offer to download or view info
      handleUploadFileClick(file);
    }
  };

  const openFileEditor = async (file: FileInfo) => {
    try {
      const response = await fetch(file.path);
      if (response.ok) {
        const content = await response.text();
        
        // Open a simple editor modal or new window with the content
        const editorWindow = window.open('', '_blank', 'width=800,height=600');
        if (editorWindow) {
          editorWindow.document.write(`
            <html>
              <head>
                <title>Edit ${file.name}</title>
                <style>
                  body { font-family: monospace; margin: 20px; }
                  textarea { width: 100%; height: 80vh; font-family: monospace; }
                  .header { background: #f5f5f5; padding: 10px; margin: -20px -20px 20px -20px; }
                  .buttons { margin-top: 10px; }
                  button { padding: 8px 16px; margin-right: 10px; cursor: pointer; }
                  .save { background: #4CAF50; color: white; border: none; }
                  .cancel { background: #f44336; color: white; border: none; }
                </style>
              </head>
              <body>
                <div class="header">
                  <h3>Editing: ${file.name}</h3>
                  <small>Type: ${file.type} | Path: ${file.path}</small>
                </div>
                <textarea id="content">${content}</textarea>
                <div class="buttons">
                  <button class="save" onclick="saveFile()">Save Changes</button>
                  <button class="cancel" onclick="window.close()">Cancel</button>
                </div>
                <script>
                  function saveFile() {
                    const content = document.getElementById('content').value;
                    // For now, we'll just show an alert. In a real implementation, 
                    // you'd send this back to the server via an API
                    alert('Save functionality would be implemented via API call to update the file content.');
                    console.log('Content to save:', content);
                  }
                </script>
              </body>
            </html>
          `);
        }
      } else {
        alert('Failed to load file content');
      }
    } catch (error) {
      alert('Error loading file: ' + error);
    }
  };

  const handleUploadFileClick = (file: FileInfo) => {
    alert(`Upload File: ${file.name}\nType: ${getFileTypeLabel(file.type)}\nSize: ${file.size}\n\nNote: Download functionality would be implemented with proper API endpoints.`);
  };

  const handleUpload = (deletedFile: FileInfo) => {
    // Create a file input element
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = deletedFile.type === 'upload' ? '.xlsx,.xls,.csv' : '.json';
    
    input.onchange = async (event) => {
      const target = event.target as HTMLInputElement;
      const file = target.files?.[0];
      
      if (file) {
        try {
          const formData = new FormData();
          formData.append('file', file);
          formData.append('symbol', ticker);
          formData.append('exchange', data?.company.exchange || 'NASDAQ');
          
          // Show uploading state
          const updatedFiles = data?.files.map(f => 
            f.name === deletedFile.name 
              ? { ...f, deleted: false, name: file.name, size: `${(file.size / 1024).toFixed(1)} KB` }
              : f
          ) || [];
          
          setData(prev => prev ? { ...prev, files: updatedFiles } : null);
          
          // Upload the file
          const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData,
          });

          if (response.ok) {
            // Refresh the folder data to show the new file
            await loadCompanyFolderData();
          } else {
            throw new Error('Upload failed');
          }
        } catch (error) {
          alert('Upload failed: ' + error);
          // Revert the UI state
          await loadCompanyFolderData();
        }
      }
    };
    
    input.click();
  };

  const confirmDelete = (file: FileInfo) => {
    setFileToDelete(file);
  };

  const handleDelete = async () => {
    if (!fileToDelete || !data) return;
    
    setDeleting(true);
    
    try {
      // For this demo, we'll simulate the delete operation
      // In a real implementation, you'd call an API to delete the file
      
      // Simulate API call delay
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Remove the file immediately from the list after confirmation
      const updatedFiles = data.files.filter(file => file.name !== fileToDelete.name);
      persistDeletedFile(fileToDelete.name);
      setData({ ...data, files: updatedFiles });
      setFileToDelete(null);
      
      // In a real implementation, you would call something like:
      // await fetch(`/api/files/${fileToDelete.type}/${ticker}/${fileToDelete.name}`, { method: 'DELETE' });
      
    } catch (error) {
      alert('Delete failed: ' + error);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-background">
        <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
          <div className="text-center py-12">
            <div className={`animate-spin rounded-full h-12 w-12 border-b-2 ${isDarkMode ? 'border-blue-400' : 'border-blue-600'} mx-auto`}></div>
            <p className={`mt-4 text-sm ${isDarkMode ? 'text-slate-300' : 'text-gray-600'}`}>Loading company folder...</p>
          </div>
        </div>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="min-h-screen bg-background">
        <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
          <div className="text-center py-12">
            <div className={`${isDarkMode ? 'text-red-400' : 'text-red-600'} mb-4`}>
              <svg className="mx-auto h-12 w-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.464 0L4.35 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <h3 className={`text-lg font-medium ${isDarkMode ? 'text-slate-100' : 'text-gray-900'} mb-2`}>Company Not Found</h3>
            <p className={`mb-4 ${isDarkMode ? 'text-slate-300' : 'text-gray-600'}`}>{error || 'Company folder not found'}</p>
            <Link
              href="/memory"
              className={`px-4 py-2 text-sm font-medium rounded-full transition ${isDarkMode ? 'bg-blue-500 text-white hover:bg-blue-400' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
            >
              Back to Memory
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-[1400px] py-8 px-6 md:px-10">
        {/* Header with Breadcrumb */}
        <div className="mb-8">
          <nav className="flex mb-4" aria-label="Breadcrumb">
            <ol className="inline-flex items-center space-x-1 md:space-x-3">
              <li className="inline-flex items-center">
                <Link href="/memory" className="inline-flex items-center text-sm font-medium text-gray-700 hover:text-blue-600">
                  <svg className="mr-2.5 w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z"></path>
                  </svg>
                  Memory
                </Link>
              </li>
              <li>
                <div className="flex items-center">
                  <svg className="w-6 h-6 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd"></path>
                  </svg>
                  <span className="ml-1 text-sm font-medium text-gray-500 md:ml-2">{data.company.ticker}</span>
                </div>
              </li>
            </ol>
          </nav>

          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className={`${isDarkMode ? 'bg-blue-500/10 text-blue-300' : 'bg-blue-100 text-blue-600'} p-3 rounded-lg`}>
                <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2-2H5a2 2 0 00-2 2v5a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <h1 className={`text-3xl font-bold ${headingColor}`}>{data.company.ticker}</h1>
                <p className={mutedText}>{data.company.name}</p>
                <p className={`text-sm ${isDarkMode ? 'text-slate-500' : 'text-gray-500'}`}>{data.company.exchange}</p>
              </div>
            </div>

            <Link
              href={`/company/${ticker}/timing`}
              className={`px-4 py-2 text-sm font-medium rounded-full transition ${isDarkMode ? 'bg-blue-500 text-white hover:bg-blue-400' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
            >
              Open Analysis
            </Link>
          </div>
        </div>

        {/* File Management Controls */}
        <div className="mb-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className={`text-lg font-semibold ${headingColor}`}>Folder Contents</h2>
              <p className={`text-sm ${mutedText}`}>{sortedFiles.length} files</p>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <span className={`text-sm font-medium ${labelColor}`}>View</span>
                <div className={`inline-flex h-11 items-center rounded-full border px-1 ${isDarkMode ? 'border-slate-800' : 'border-gray-300'}`}>
                  <button
                    onClick={() => setViewMode('list')}
                    className={`h-9 px-4 text-sm font-semibold rounded-full transition ${
                      viewMode === 'list'
                        ? isDarkMode
                          ? 'bg-blue-500 text-white shadow-sm'
                          : 'bg-blue-600 text-white shadow-sm'
                        : isDarkMode
                          ? 'text-slate-200 hover:bg-slate-800'
                          : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    List
                  </button>
                  <button
                    onClick={() => setViewMode('grid')}
                    className={`h-9 px-4 text-sm font-semibold rounded-full transition ${
                      viewMode === 'grid'
                        ? isDarkMode
                          ? 'bg-blue-500 text-white shadow-sm'
                          : 'bg-blue-600 text-white shadow-sm'
                        : isDarkMode
                          ? 'text-slate-200 hover:bg-slate-800'
                          : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    Grid
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className={`text-sm font-medium ${labelColor}`}>Sort by</span>
                <select
                  value={sortBy}
                  onChange={(e) => handleSort(e.target.value as 'name' | 'type' | 'lastModified')}
                  className={`h-11 rounded-full border px-4 text-sm shadow-sm transition focus:outline-none focus:ring-2 ${
                    isDarkMode
                      ? 'bg-transparent border-slate-700 text-slate-100 focus:ring-slate-500'
                      : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-500'
                  }`}
                >
                  <option value="type">File Type</option>
                  <option value="name">File Name</option>
                  <option value="lastModified">Date Modified</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* File Display */}
        {sortedFiles.length === 0 ? (
          <div className={`text-center py-12 rounded-2xl ${cardSurface} ${isDarkMode ? 'text-slate-100' : 'text-gray-900'}`}>
            <svg className={`mx-auto h-12 w-12 ${isDarkMode ? 'text-slate-500' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            <h3 className="mt-4 text-lg font-medium">Empty Folder</h3>
            <p className={`mt-2 text-sm ${mutedText}`}>
              No files found for this company. Start by running an analysis to generate data files.
            </p>
            <div className="mt-6">
              <Link
                href={`/company/${ticker}/timing`}
                className={`inline-flex items-center px-4 py-2 text-sm font-medium rounded-full transition ${
                  isDarkMode ? 'bg-blue-500 text-white hover:bg-blue-400' : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                Start Analysis
              </Link>
            </div>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {sortedFiles.map((file, index) => (
              <div 
                key={index} 
                className={`${gridCardSurface} rounded-2xl p-6 shadow-sm transition hover:shadow-md hover:border-slate-700/80 ${
                  file.deleted ? (isDarkMode ? 'border-dashed border-slate-700' : 'border-dashed border-gray-300') : ''
                } ${isDarkMode ? 'text-slate-100' : 'text-gray-900'}`}
              >
                <div className="flex items-center justify-center mb-4">
                  {file.deleted ? (
                    <svg className="h-8 w-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  ) : (
                    getFileIcon(file.type)
                  )}
                </div>
                <h3 className={`text-sm font-medium text-center mb-2 truncate ${
                  file.deleted ? mutedText : headingColor
                }`} title={file.name}>
                  {file.name}
                </h3>
                <div className="flex justify-center mb-2">
                  <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                    file.deleted ? 'bg-gray-100 text-gray-600' : getFileTypeColor(file.type, isDarkMode)
                  }`}>
                    {file.deleted ? 'Deleted' : getFileTypeLabel(file.type)}
                  </span>
                </div>
                <p className={`text-xs text-center ${file.deleted ? 'text-gray-400' : mutedText}`}>
                  {file.size}
                </p>
                <p className={`text-xs text-center mt-1 ${file.deleted ? 'text-gray-400' : mutedText}`}>
                  {new Date(file.lastModified).toLocaleDateString()}
                </p>
                
                {/* Action Buttons */}
                <div className="mt-4 flex flex-col gap-2">
                  {file.deleted ? (
                    <button
                      onClick={() => handleUpload(file)}
                      className="w-full px-3 py-2 bg-green-600 text-white text-xs font-medium rounded-md hover:bg-green-700"
                    >
                      Upload
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => handleFileClick(file)}
                        className="w-full px-3 py-2 bg-blue-600 text-white text-xs font-medium rounded-md hover:bg-blue-700"
                      >
                        {file.type === 'upload' ? 'View' : 'Edit'}
                      </button>
                      <button
                        onClick={() => confirmDelete(file)}
                        className="w-full px-3 py-2 bg-red-600 text-white text-xs font-medium rounded-md hover:bg-red-700"
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className={`rounded-2xl overflow-hidden border ${isDarkMode ? 'border-slate-800/70' : 'border-gray-200'}`}>
            <table className="min-w-full">
              <thead className="bg-transparent">
                <tr>
                  <th className={`px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider ${isDarkMode ? 'text-slate-300' : 'text-gray-600'}`}>
                    File
                  </th>
                  <th 
                    onClick={() => handleSort('type')}
                    className={`px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider cursor-pointer ${
                      isDarkMode ? 'text-slate-300' : 'text-gray-600'
                    }`}
                  >
                    Type {sortBy === 'type' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className={`px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider ${isDarkMode ? 'text-slate-300' : 'text-gray-600'}`}>
                    Size/Info
                  </th>
                  <th 
                    onClick={() => handleSort('lastModified')}
                    className={`px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider cursor-pointer ${
                      isDarkMode ? 'text-slate-300' : 'text-gray-600'
                    }`}
                  >
                    Last Modified {sortBy === 'lastModified' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className={`px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider ${isDarkMode ? 'text-slate-300' : 'text-gray-600'}`}>
                    Actions
                  </th>
                  <th className={`px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider ${isDarkMode ? 'text-slate-300' : 'text-gray-600'}`}>
                    Delete
                  </th>
                </tr>
              </thead>
              <tbody className={isDarkMode ? 'divide-y divide-slate-800/70' : 'divide-y divide-gray-200'}>
                {sortedFiles.map((file, index) => (
                  <tr key={index} className={`${isDarkMode ? 'hover:bg-slate-800/50' : 'hover:bg-gray-50'} ${file.deleted ? 'opacity-75' : ''} transition`}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 h-6 w-6">
                          {file.deleted ? (
                            <svg className={`h-6 w-6 ${isDarkMode ? 'text-slate-500' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                          ) : (
                            getFileIcon(file.type)
                          )}
                        </div>
                        <div className="ml-3">
                          <div className={`text-sm font-medium ${file.deleted ? mutedText : headingColor}`}>
                            {file.name}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                        file.deleted ? 'bg-gray-100 text-gray-600' : getFileTypeColor(file.type, isDarkMode)
                      }`}>
                        {file.deleted ? 'Deleted' : getFileTypeLabel(file.type)}
                      </span>
                    </td>
                    <td className={`px-6 py-4 whitespace-nowrap text-sm ${file.deleted ? 'text-gray-400' : mutedText}`}>
                      {file.size}
                    </td>
                    <td className={`px-6 py-4 whitespace-nowrap text-sm ${file.deleted ? 'text-gray-400' : mutedText}`}>
                      {new Date(file.lastModified).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {file.deleted ? (
                        <button
                          onClick={() => handleUpload(file)}
                          className={`${isDarkMode ? 'text-green-300 hover:text-green-200' : 'text-green-600 hover:text-green-900'} font-medium`}
                        >
                          Upload
                        </button>
                      ) : (
                        <button
                          onClick={() => handleFileClick(file)}
                          className={isDarkMode ? 'text-blue-300 hover:text-blue-200' : 'text-blue-600 hover:text-blue-900'}
                        >
                          {file.type === 'upload' ? 'View' : 'Edit'}
                        </button>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {!file.deleted && (
                        <button
                          onClick={() => confirmDelete(file)}
                          className={isDarkMode ? 'text-red-300 hover:text-red-200 font-medium' : 'text-red-600 hover:text-red-900 font-medium'}
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {fileToDelete && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm overflow-y-auto h-full w-full z-50">
            <div className={`relative top-20 mx-auto p-5 w-96 rounded-2xl shadow-xl ${cardSurface} ${isDarkMode ? 'text-slate-100' : 'text-gray-900'}`}>
              <div className="mt-3">
                <div className="flex items-center justify-center mb-4">
                  <div className={`mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full ${isDarkMode ? 'bg-red-500/10' : 'bg-red-100'}`}>
                    <svg className={`h-6 w-6 ${isDarkMode ? 'text-red-300' : 'text-red-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.464 0L4.35 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                  </div>
                </div>
                
                <div className="text-center">
                  <h3 className="text-lg font-medium mb-2">
                    Are you sure?
                  </h3>
                  <p className={`text-sm mb-4 ${mutedText}`}>
                    Do you want to delete <strong>{fileToDelete.name}</strong>?
                    <br />
                    This action cannot be undone, but you can upload a new file afterwards.
                  </p>
                </div>
                
                <div className="flex gap-3 justify-center">
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className={`px-4 py-2 text-sm font-medium rounded-full transition ${
                      isDarkMode ? 'bg-red-500 text-white hover:bg-red-400' : 'bg-red-600 text-white hover:bg-red-700'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {deleting ? 'Deleting...' : 'Yes, Delete'}
                  </button>
                  <button
                    onClick={() => setFileToDelete(null)}
                    disabled={deleting}
                    className={`px-4 py-2 text-sm font-medium rounded-full border transition ${
                      isDarkMode
                        ? 'border-slate-700 text-slate-100 hover:bg-slate-800/70'
                        : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

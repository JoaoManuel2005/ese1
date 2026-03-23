"use client";

interface SharePointColumn {
  name: string;
  displayName: string;
  type: string;
  required: boolean;
  readOnly: boolean;
}

interface SharePointList {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  columns: SharePointColumn[];
  webUrl: string;
  itemCount?: number;
}

interface SharePointLibrary {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  webUrl: string;
  driveType: string;
}

interface SharePointMetadata {
  siteUrl: string;
  siteId: string;
  siteName: string;
  lists: SharePointList[];
  libraries: SharePointLibrary[];
  errorMessage?: string;
}

interface SharePointMetadataViewProps {
  metadata: SharePointMetadata[];
}

export function SharePointMetadataView({ metadata }: SharePointMetadataViewProps) {
  if (!metadata || metadata.length === 0) {
    return null;
  }

  return (
    <div className="sharepoint-metadata-section">
      <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 22C6.486 22 2 17.514 2 12S6.486 2 12 2s10 4.486 10 10-4.486 10-10 10z"/>
          <path d="M12 6c-3.309 0-6 2.691-6 6s2.691 6 6 6 6-2.691 6-6-2.691-6-6-6zm0 10c-2.206 0-4-1.794-4-4s1.794-4 4-4 4 1.794 4 4-1.794 4-4 4z"/>
        </svg>
        SharePoint Data Detected
      </h3>

      {metadata.map((site, idx) => (
        <div key={idx} className="mb-6 p-4 border rounded-lg bg-slate-50 dark:bg-slate-800/50">
          {site.errorMessage ? (
            <div className="text-red-600 dark:text-red-400">
              <strong>Error:</strong> {site.errorMessage}
              <br />
              <span className="text-sm">Site: {site.siteUrl}</span>
            </div>
          ) : (
            <>
              <div className="mb-4">
                <h4 className="font-semibold text-base mb-1">{site.siteName}</h4>
                <a 
                  href={site.siteUrl} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                >
                  {site.siteUrl}
                </a>
              </div>

              {site.lists.length > 0 && (
                <div className="mb-4">
                  <h5 className="font-medium text-sm mb-2 text-gray-700 dark:text-gray-300">
                    Lists ({site.lists.length})
                  </h5>
                  <div className="space-y-3">
                    {site.lists.map((list) => (
                      <details key={list.id} className="bg-white dark:bg-slate-900 p-3 rounded border">
                        <summary className="cursor-pointer font-medium text-sm hover:text-blue-600 dark:hover:text-blue-400">
                          {list.displayName || list.name}
                          {list.columns.length > 0 && (
                            <span className="ml-2 text-xs text-gray-500">
                              ({list.columns.length} columns)
                            </span>
                          )}
                        </summary>
                        <div className="mt-3 text-sm">
                          {list.description && (
                            <p className="text-gray-600 dark:text-gray-400 mb-2">
                              {list.description}
                            </p>
                          )}
                          <a 
                            href={list.webUrl} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-xs text-blue-600 dark:text-blue-400 hover:underline block mb-2"
                          >
                            Open in SharePoint →
                          </a>
                          
                          {list.columns.length > 0 && (
                            <div className="mt-2">
                              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                                Columns:
                              </div>
                              <div className="grid grid-cols-1 gap-1">
                                {list.columns.map((col, colIdx) => (
                                  <div 
                                    key={colIdx} 
                                    className="text-xs flex items-center gap-2 py-1 px-2 bg-slate-50 dark:bg-slate-800 rounded"
                                  >
                                    <span className="font-mono text-purple-600 dark:text-purple-400">
                                      {col.displayName || col.name}
                                    </span>
                                    <span className="text-gray-500">
                                      ({col.type})
                                    </span>
                                    {col.required && (
                                      <span className="text-red-500 text-[10px] font-semibold">
                                        REQUIRED
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </details>
                    ))}
                  </div>
                </div>
              )}

              {site.libraries.length > 0 && (
                <div>
                  <h5 className="font-medium text-sm mb-2 text-gray-700 dark:text-gray-300">
                    Document Libraries ({site.libraries.length})
                  </h5>
                  <div className="space-y-2">
                    {site.libraries.map((lib) => (
                      <div key={lib.id} className="bg-white dark:bg-slate-900 p-3 rounded border">
                        <div className="font-medium text-sm">
                          {lib.displayName || lib.name}
                        </div>
                        {lib.description && (
                          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                            {lib.description}
                          </p>
                        )}
                        <a 
                          href={lib.webUrl} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-xs text-blue-600 dark:text-blue-400 hover:underline block mt-1"
                        >
                          Open in SharePoint →
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      ))}

      <div className="text-xs text-gray-500 dark:text-gray-400 mt-3 p-2 bg-blue-50 dark:bg-blue-900/20 rounded">
        ℹ️ This data was automatically fetched from SharePoint using Microsoft Graph API
      </div>
    </div>
  );
}

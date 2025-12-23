'use client';

import { useState, useEffect, useCallback } from 'react';
import { 
  FolderOpen, 
  FileText, 
  ChevronRight, 
  ChevronLeft, 
  Loader2, 
  AlertCircle,
  CheckCircle,
  Clock,
  XCircle,
  RefreshCw
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface VaultInfo {
  id: string;
  name: string;
  totalObjects?: number;
  totalBytes?: number;
  createdAt?: string;
}

interface VaultObject {
  id: string;
  filename: string;
  sizeBytes: number;
  ingestionStatus: 'pending' | 'processing' | 'completed' | 'failed';
  pageCount?: number;
  createdAt?: string;
}

interface VaultBrowserProps {
  onDocumentSelect: (vaultId: string, document: VaultObject) => void;
  className?: string;
}

export function VaultBrowser({ onDocumentSelect, className }: VaultBrowserProps) {
  const [vaults, setVaults] = useState<VaultInfo[]>([]);
  const [selectedVault, setSelectedVault] = useState<VaultInfo | null>(null);
  const [documents, setDocuments] = useState<VaultObject[]>([]);
  const [isLoadingVaults, setIsLoadingVaults] = useState(true);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load vaults on mount
  useEffect(() => {
    loadVaults();
  }, []);

  const loadVaults = async () => {
    setIsLoadingVaults(true);
    setError(null);
    try {
      const response = await fetch('/api/vault');
      if (!response.ok) {
        throw new Error('Failed to load vaults');
      }
      const data = await response.json();
      setVaults(data.vaults || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load vaults');
    } finally {
      setIsLoadingVaults(false);
    }
  };

  const loadDocuments = useCallback(async (vault: VaultInfo) => {
    setIsLoadingDocuments(true);
    setError(null);
    try {
      const response = await fetch(`/api/vault/${vault.id}/objects`);
      if (!response.ok) {
        throw new Error('Failed to load documents');
      }
      const data = await response.json();
      setDocuments(data.objects || []);
      setSelectedVault(vault);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load documents');
    } finally {
      setIsLoadingDocuments(false);
    }
  }, []);

  const handleVaultClick = (vault: VaultInfo) => {
    loadDocuments(vault);
  };

  const handleBackToVaults = () => {
    setSelectedVault(null);
    setDocuments([]);
  };

  const handleDocumentClick = (doc: VaultObject) => {
    if (doc.ingestionStatus !== 'completed') {
      return; // Can't select documents that aren't fully processed
    }
    if (selectedVault) {
      onDocumentSelect(selectedVault.id, doc);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return '';
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const getStatusIcon = (status: VaultObject['ingestionStatus']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'processing':
        return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
      case 'pending':
        return <Clock className="w-4 h-4 text-yellow-500" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return null;
    }
  };

  const getStatusBadge = (status: VaultObject['ingestionStatus']) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      completed: 'default',
      processing: 'secondary',
      pending: 'outline',
      failed: 'destructive',
    };
    return (
      <Badge variant={variants[status] || 'outline'} className="text-xs">
        {status}
      </Badge>
    );
  };

  if (error) {
    return (
      <Card className={cn('', className)}>
        <CardContent className="pt-6">
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <AlertCircle className="w-10 h-10 text-destructive mb-3" />
            <p className="text-sm text-destructive mb-4">{error}</p>
            <Button variant="outline" size="sm" onClick={loadVaults}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Try Again
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Show documents list when a vault is selected
  if (selectedVault) {
    return (
      <Card className={cn('', className)}>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={handleBackToVaults} className="h-8 px-2">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <div className="flex-1">
              <CardTitle className="text-lg">{selectedVault.name}</CardTitle>
              <CardDescription>
                {documents.length} document{documents.length !== 1 ? 's' : ''} • Select one to redact
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => loadDocuments(selectedVault)} className="h-8 px-2">
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoadingDocuments ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : documents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileText className="w-10 h-10 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">No documents in this vault</p>
            </div>
          ) : (
            <ScrollArea className="h-[400px]">
              <div className="space-y-2">
                {documents.map((doc) => (
                  <button
                    key={doc.id}
                    onClick={() => handleDocumentClick(doc)}
                    disabled={doc.ingestionStatus !== 'completed'}
                    className={cn(
                      'w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors',
                      doc.ingestionStatus === 'completed'
                        ? 'hover:bg-muted cursor-pointer'
                        : 'opacity-60 cursor-not-allowed',
                      'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2'
                    )}
                  >
                    <div className="w-10 h-10 rounded bg-muted flex items-center justify-center flex-shrink-0">
                      <FileText className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{doc.filename}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{formatBytes(doc.sizeBytes)}</span>
                        {doc.pageCount && <span>• {doc.pageCount} pages</span>}
                        {doc.createdAt && <span>• {formatDate(doc.createdAt)}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {getStatusIcon(doc.ingestionStatus)}
                      {doc.ingestionStatus !== 'completed' && getStatusBadge(doc.ingestionStatus)}
                      {doc.ingestionStatus === 'completed' && (
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    );
  }

  // Show vaults list
  return (
    <Card className={cn('', className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">Select a Vault</CardTitle>
            <CardDescription>
              Choose a vault to browse documents for redaction
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={loadVaults} className="h-8 px-2">
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoadingVaults ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : vaults.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <FolderOpen className="w-10 h-10 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground mb-1">No vaults found</p>
            <p className="text-xs text-muted-foreground">
              Upload a new document to create a vault
            </p>
          </div>
        ) : (
          <ScrollArea className="h-[400px]">
            <div className="space-y-2">
              {vaults.map((vault) => (
                <button
                  key={vault.id}
                  onClick={() => handleVaultClick(vault)}
                  className={cn(
                    'w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors',
                    'hover:bg-muted cursor-pointer',
                    'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2'
                  )}
                >
                  <div className="w-10 h-10 rounded bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <FolderOpen className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{vault.name}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {vault.totalObjects !== undefined && (
                        <span>{vault.totalObjects} document{vault.totalObjects !== 1 ? 's' : ''}</span>
                      )}
                      {vault.totalBytes !== undefined && vault.totalBytes > 0 && (
                        <span>• {formatBytes(vault.totalBytes)}</span>
                      )}
                      {vault.createdAt && <span>• {formatDate(vault.createdAt)}</span>}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                </button>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

'use client';

import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, File, X, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

export interface UploadedFile {
  id: string;
  file: File;
  progress: number;
  status: 'pending' | 'uploading' | 'complete' | 'error';
  error?: string;
}

interface DropZoneProps {
  onFilesSelected: (files: File[]) => void;
  onFileRemove?: (fileId: string) => void;
  files?: UploadedFile[];
  maxFiles?: number;
  disabled?: boolean;
  className?: string;
}

export function DropZone({ onFilesSelected, onFileRemove, files = [], maxFiles = 10, disabled = false, className }: DropZoneProps) {
  const [dragError, setDragError] = useState<string | null>(null);
  const maxSize = 50 * 1024 * 1024;

  const onDrop = useCallback((acceptedFiles: File[], rejectedFiles: readonly { file: File; errors: readonly { code: string; message: string }[] }[]) => {
    setDragError(null);
    if (rejectedFiles.length > 0) {
      setDragError(rejectedFiles.map((f) => `${f.file.name}: ${f.errors[0]?.message}`).join(', '));
      return;
    }
    if (files.length + acceptedFiles.length > maxFiles) {
      setDragError(`Maximum ${maxFiles} files allowed`);
      return;
    }
    onFilesSelected(acceptedFiles);
  }, [files.length, maxFiles, onFilesSelected]);

  const { getRootProps, getInputProps, isDragActive, isDragReject } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'], 'image/*': ['.png', '.jpg', '.jpeg', '.tiff'] },
    maxSize,
    maxFiles: maxFiles - files.length,
    disabled,
  });

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className={cn('space-y-4', className)}>
      <div
        {...getRootProps()}
        className={cn(
          'border-2 border-dashed rounded-lg p-8 transition-colors cursor-pointer text-center',
          'hover:border-primary/50 hover:bg-muted/50',
          isDragActive && !isDragReject && 'border-primary bg-primary/5',
          isDragReject && 'border-destructive bg-destructive/5',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
      >
        <input {...getInputProps()} />
        <div className="flex flex-col items-center">
          <div className={cn('w-12 h-12 rounded-full flex items-center justify-center mb-4', isDragActive ? 'bg-primary/10' : 'bg-muted')}>
            <Upload className={cn('w-6 h-6', isDragActive ? 'text-primary' : 'text-muted-foreground')} />
          </div>
          <p className="text-sm font-medium mb-1">{isDragActive ? 'Drop files here...' : 'Drag & drop files here, or click to select'}</p>
          <p className="text-xs text-muted-foreground">PDF, PNG, JPG, TIFF up to {formatBytes(maxSize)} each • Max {maxFiles} files</p>
        </div>
      </div>

      {dragError && (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="w-4 h-4" />
          {dragError}
        </div>
      )}

      {files.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">{files.length} file{files.length !== 1 ? 's' : ''} selected</p>
          {files.map((f) => (
            <div key={f.id} className={cn('flex items-center gap-3 p-3 rounded-lg border bg-card', f.status === 'error' && 'border-destructive')}>
              <div className="w-10 h-10 rounded bg-muted flex items-center justify-center">
                <File className="w-5 h-5 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{f.file.name}</p>
                <p className="text-xs text-muted-foreground">{formatBytes(f.file.size)}</p>
                {f.status === 'uploading' && <Progress value={f.progress} className="h-1 mt-2" />}
                {f.status === 'error' && f.error && <p className="text-xs text-destructive mt-1">{f.error}</p>}
              </div>
              <div className="flex items-center gap-2">
                {f.status === 'complete' && <span className="text-xs text-green-600 font-medium">Uploaded</span>}
                {onFileRemove && (
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onFileRemove(f.id)}>
                    <X className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

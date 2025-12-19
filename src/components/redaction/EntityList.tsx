'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { Eye, EyeOff, Check, X, Search, Pencil, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { EntityType } from '@/lib/redaction/patterns';

export interface DetectedEntity {
  id: string;
  type: EntityType;
  value: string;
  maskedValue: string;
  normalizedValue?: string;
  pageNumber: number;
  confidence: number;
  detectionMethod: 'regex' | 'llm';
  context?: string;
  shouldRedact: boolean;
}

interface EntityListProps {
  entities: DetectedEntity[];
  selectedEntityId: string | null;
  onEntityToggle: (entityId: string, shouldRedact: boolean) => void;
  onEntitySelect: (entityId: string) => void;
  onSelectAll: (shouldRedact: boolean) => void;
  onMaskedValueUpdate?: (entityId: string, newMaskedValue: string) => void;
  className?: string;
}

const DETECTION_METHOD_LABELS: Record<string, string> = {
  regex: 'Pattern Match',
  llm: 'AI Detection',
};

export function EntityList({ 
  entities, 
  selectedEntityId,
  onEntityToggle, 
  onEntitySelect,
  onSelectAll,
  onMaskedValueUpdate,
  className 
}: EntityListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showMasked, setShowMasked] = useState(true);
  const [isEditingMaskedValue, setIsEditingMaskedValue] = useState(false);
  const [editedMaskedValue, setEditedMaskedValue] = useState('');
  const entityRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    if (selectedEntityId) {
      const element = entityRefs.current.get(selectedEntityId);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
    // Reset editing state when selection changes
    setIsEditingMaskedValue(false);
    setEditedMaskedValue('');
  }, [selectedEntityId]);

  const filteredEntities = useMemo(() => {
    return entities.filter((e) =>
      searchQuery === '' ||
      e.value.toLowerCase().includes(searchQuery.toLowerCase()) ||
      e.maskedValue.toLowerCase().includes(searchQuery.toLowerCase()) ||
      e.type.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [entities, searchQuery]);

  const stats = useMemo(() => ({
    total: entities.length,
    toRedact: entities.filter((e) => e.shouldRedact).length,
  }), [entities]);

  const selectedEntity = selectedEntityId 
    ? entities.find(e => e.id === selectedEntityId) 
    : null;

  return (
    <Card className={cn('flex flex-col h-full', className)}>
      {/* Fixed Header */}
      <CardHeader className="p-4 pb-3 space-y-0 shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold tracking-tight">
            Detected PII
            <span className="ml-2 text-muted-foreground font-normal">({stats.total})</span>
          </CardTitle>
          <Button 
            variant="ghost" 
            size="sm" 
            className="h-8 px-2 text-xs"
            onClick={() => setShowMasked(!showMasked)}
          >
            {showMasked ? <EyeOff className="w-3.5 h-3.5 mr-1.5" /> : <Eye className="w-3.5 h-3.5 mr-1.5" />}
            {showMasked ? 'Show Original' : 'Show Redacted'}
          </Button>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
          <span className="font-medium">{stats.toRedact} to redact</span>
          <span className="text-border">•</span>
          <span>{stats.total - stats.toRedact} excluded</span>
        </div>
      </CardHeader>

      {/* Fixed Search and Actions */}
      <div className="px-4 pb-3 space-y-2 shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search entities..."
            className="w-full pl-9 pr-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => onSelectAll(true)}>
            <Check className="w-3.5 h-3.5 mr-1.5" />Select All
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => onSelectAll(false)}>
            <X className="w-3.5 h-3.5 mr-1.5" />Deselect All
          </Button>
        </div>
      </div>

      <Separator className="shrink-0" />

      {/* Scrollable Content Area */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Selected Entity Detail Panel */}
        {selectedEntity && (
          <div className="m-3 p-4 bg-muted/40 rounded-lg border">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center px-2 py-1 text-xs font-medium bg-zinc-800 text-white rounded">
                    {selectedEntity.type.replace('_', ' ')}
                  </span>
                  <span className="text-xs text-muted-foreground">Page {selectedEntity.pageNumber}</span>
                </div>
                
                <div className="space-y-2">
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Original Value</label>
                    <div className="text-sm font-mono bg-background px-3 py-2 rounded border break-all">
                      {selectedEntity.value}
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs text-muted-foreground">Redacted As</label>
                      {onMaskedValueUpdate && (
                        isEditingMaskedValue ? (
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-xs"
                              onClick={() => {
                                onMaskedValueUpdate(selectedEntity.id, editedMaskedValue);
                                setIsEditingMaskedValue(false);
                              }}
                            >
                              <Save className="w-3 h-3 mr-1" />
                              Save
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-xs"
                              onClick={() => {
                                setIsEditingMaskedValue(false);
                                setEditedMaskedValue(selectedEntity.maskedValue);
                              }}
                            >
                              <X className="w-3 h-3" />
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            onClick={() => {
                              setEditedMaskedValue(selectedEntity.maskedValue);
                              setIsEditingMaskedValue(true);
                            }}
                          >
                            <Pencil className="w-3 h-3 mr-1" />
                            Edit
                          </Button>
                        )
                      )}
                    </div>
                    {isEditingMaskedValue ? (
                      <input
                        type="text"
                        value={editedMaskedValue}
                        onChange={(e) => setEditedMaskedValue(e.target.value)}
                        className="w-full text-sm font-mono bg-background px-3 py-2 rounded border focus:outline-none focus:ring-2 focus:ring-ring"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            onMaskedValueUpdate?.(selectedEntity.id, editedMaskedValue);
                            setIsEditingMaskedValue(false);
                          } else if (e.key === 'Escape') {
                            setIsEditingMaskedValue(false);
                            setEditedMaskedValue(selectedEntity.maskedValue);
                          }
                        }}
                      />
                    ) : (
                      <div className="text-sm font-mono bg-background px-3 py-2 rounded border break-all">
                        {selectedEntity.maskedValue}
                      </div>
                    )}
                  </div>
                  {selectedEntity.normalizedValue && selectedEntity.normalizedValue !== selectedEntity.value && (
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">Normalized Value</label>
                      <div className="text-sm font-mono bg-background px-3 py-2 rounded border break-all">
                        {selectedEntity.normalizedValue}
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-6 pt-1">
                  <div>
                    <label className="text-xs text-muted-foreground block">Detection</label>
                    <span className="text-sm font-medium">
                      {DETECTION_METHOD_LABELS[selectedEntity.detectionMethod] || selectedEntity.detectionMethod}
                    </span>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block">Confidence</label>
                    <span className="text-sm font-medium">{Math.round(selectedEntity.confidence * 100)}%</span>
                  </div>
                </div>

                {selectedEntity.context && (
                  <div className="pt-1">
                    <label className="text-xs text-muted-foreground block mb-1">Why flagged</label>
                    <p className="text-xs text-muted-foreground">
                      {selectedEntity.context}
                    </p>
                  </div>
                )}
              </div>
              <Checkbox
                checked={selectedEntity.shouldRedact}
                onCheckedChange={(checked) => onEntityToggle(selectedEntity.id, checked as boolean)}
                className="mt-1"
              />
            </div>
          </div>
        )}

        {/* Entity List */}
        <CardContent className="p-2">
          {filteredEntities.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">
              {entities.length === 0 ? 'No PII detected' : 'No entities match your search'}
            </div>
          ) : (
            <div className="space-y-1">
              {filteredEntities.map((entity) => (
                <div
                  key={entity.id}
                  ref={(el) => {
                    if (el) entityRefs.current.set(entity.id, el);
                  }}
                  onClick={() => onEntitySelect(entity.id)}
                  className={cn(
                    'flex items-start gap-3 p-3 rounded-md transition-colors cursor-pointer',
                    'hover:bg-muted/50',
                    selectedEntityId === entity.id && 'bg-muted ring-1 ring-border',
                    !entity.shouldRedact && 'opacity-50'
                  )}
                >
                  <Checkbox
                    checked={entity.shouldRedact}
                    onCheckedChange={(checked) => {
                      onEntityToggle(entity.id, checked as boolean);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium bg-zinc-800 text-white rounded">
                        {entity.type.replace('_', ' ')}
                      </span>
                      <span className="text-[10px] text-muted-foreground">Page {entity.pageNumber}</span>
                    </div>
                    {/* Show both original and redacted values */}
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground shrink-0">Original:</span>
                        <p className="text-sm font-mono truncate">{entity.value}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground shrink-0">Redacted:</span>
                        <p className="text-sm font-mono truncate text-muted-foreground">{entity.maskedValue}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-muted-foreground">
                        {Math.round(entity.confidence * 100)}%
                      </span>
                      <span className="text-[10px] text-muted-foreground">•</span>
                      <span className="text-[10px] text-muted-foreground">
                        {DETECTION_METHOD_LABELS[entity.detectionMethod] || entity.detectionMethod}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </div>
    </Card>
  );
}

'use client';

import { Check } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { EntityType, REDACTION_PRESETS, RedactionPresetKey } from '@/lib/redaction/patterns';

const ENTITY_CONFIG: Record<EntityType, { label: string }> = {
  SSN: { label: 'Social Security Numbers' },
  ACCOUNT_NUMBER: { label: 'Bank Account Numbers' },
  CREDIT_CARD: { label: 'Credit Card Numbers' },
  NAME: { label: 'Names' },
  ADDRESS: { label: 'Addresses' },
  PHONE: { label: 'Phone Numbers' },
  EMAIL: { label: 'Email Addresses' },
  DOB: { label: 'Dates of Birth' },
  CUSTOM: { label: 'Custom Pattern' },
};

interface PatternSelectorProps {
  selectedTypes: EntityType[];
  onSelectionChange: (types: EntityType[]) => void;
  className?: string;
}

export function PatternSelector({ selectedTypes, onSelectionChange, className }: PatternSelectorProps) {
  const handlePresetSelect = (presetKey: RedactionPresetKey) => {
    onSelectionChange(REDACTION_PRESETS[presetKey].types);
  };

  const handleTypeToggle = (type: EntityType) => {
    if (selectedTypes.includes(type)) {
      onSelectionChange(selectedTypes.filter((t) => t !== type));
    } else {
      onSelectionChange([...selectedTypes, type]);
    }
  };

  const isPresetSelected = (presetKey: RedactionPresetKey) => {
    const preset = REDACTION_PRESETS[presetKey];
    return preset.types.length === selectedTypes.length && preset.types.every((t) => selectedTypes.includes(t));
  };

  return (
    <div className={cn('space-y-6', className)}>
      <Tabs defaultValue="prefigured" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="prefigured">Prefigured Redactions</TabsTrigger>
          <TabsTrigger value="custom">Custom Redaction</TabsTrigger>
        </TabsList>

        {/* Prefigured Redactions Tab */}
        <TabsContent value="prefigured" className="space-y-3 mt-4">
          <div className="grid gap-3">
            {(Object.keys(REDACTION_PRESETS) as RedactionPresetKey[]).map((key) => {
              const preset = REDACTION_PRESETS[key];
              const selected = isPresetSelected(key);
              return (
                <Card
                  key={key}
                  className={cn(
                    'cursor-pointer transition-all',
                    selected ? 'border-zinc-900 dark:border-zinc-100 bg-zinc-50 dark:bg-zinc-900' : 'hover:border-zinc-400'
                  )}
                  onClick={() => handlePresetSelect(key)}
                >
                  <CardHeader className="p-4 pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-medium">{preset.label}</CardTitle>
                      {selected && <Check className="w-4 h-4" />}
                    </div>
                    <CardDescription className="text-xs">{preset.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="p-4 pt-0">
                    <div className="flex flex-wrap gap-1.5">
                      {preset.types.map((type) => (
                        <span
                          key={type}
                          className="inline-flex items-center px-2 py-0.5 text-[10px] font-medium bg-zinc-800 text-white rounded"
                        >
                          {ENTITY_CONFIG[type].label}
                        </span>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        {/* Custom Redaction Tab */}
        <TabsContent value="custom" className="space-y-3 mt-4">
          <Card>
            <CardContent className="p-4 space-y-3">
              {(Object.keys(ENTITY_CONFIG) as EntityType[]).filter((t) => t !== 'CUSTOM').map((type) => {
                const config = ENTITY_CONFIG[type];
                const isSelected = selectedTypes.includes(type);
                return (
                  <div 
                    key={type} 
                    className={cn(
                      'flex items-center space-x-3 p-2 rounded-md transition-colors cursor-pointer',
                      isSelected ? 'bg-zinc-100 dark:bg-zinc-800' : 'hover:bg-zinc-50 dark:hover:bg-zinc-900'
                    )}
                    onClick={() => handleTypeToggle(type)}
                  >
                    <Checkbox 
                      id={type} 
                      checked={isSelected} 
                      onCheckedChange={() => handleTypeToggle(type)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <label htmlFor={type} className="text-sm cursor-pointer flex-1">
                      {config.label}
                    </label>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Selection Summary */}
      {selectedTypes.length > 0 && (
        <div className="p-4 rounded-lg bg-zinc-100 dark:bg-zinc-900 border">
          <p className="text-xs font-medium text-muted-foreground mb-2">
            {selectedTypes.length} type{selectedTypes.length !== 1 ? 's' : ''} selected
          </p>
          <div className="flex flex-wrap gap-1.5">
            {selectedTypes.map((type) => (
              <span
                key={type}
                className="inline-flex items-center px-2 py-0.5 text-[10px] font-medium bg-zinc-800 text-white rounded"
              >
                {ENTITY_CONFIG[type].label}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

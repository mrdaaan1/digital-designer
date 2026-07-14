export type TemplateStatus = 'uploaded' | 'analyzing' | 'ready' | 'failed';
export type PresentationStatus = 'pending' | 'planning' | 'generating' | 'rendering' | 'ready' | 'failed';

export type TemplateSummary = {
  id: string;
  name: string;
  status: TemplateStatus;
  created_at: string;
};

export type JobStatus = {
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  step: string | null;
  progress: number;
  error_message: string | null;
} | null;

export type SlidePatternSummary = {
  pattern_key: string;
  label: string;
  description: string | null;
};

import { CanonicalTaskStatus, FarmTaskItem } from './myFarms';

export type CalendarEventType =
  | 'planting'
  | 'crop_stage'
  | 'irrigation'
  | 'soil_test'
  | 'scouting'
  | 'harvest'
  | 'rotation_prep'
  | 'fertilizer'
  | 'analysis'
  | 'general';

export type CalendarSourceType =
  | 'task'
  | 'observation'
  | 'irrigation_log'
  | 'irrigation_recommendation'
  | 'rotation_stage'
  | 'crop_stage'
  | 'soil_recommendation'
  | 'scouting_recommendation'
  | 'analysis_report'
  | 'analysis_job';

export type CalendarProvenanceBasis =
  | 'Planned'
  | 'Scheduled'
  | 'Modelled'
  | 'Observed'
  | 'Completed';

export interface CalendarEventLinks {
  rotation_plan_id?: string | null;
  analysis_id?: string | null;
  report_id?: string | null;
  recommendation_id?: string | null;
  observation_id?: string | null;
  farm_route?: string;
  rotation_route?: string;
  report_route?: string | null;
}

export interface CalendarProjectionEvent {
  event_id: string;
  source_type: CalendarSourceType;
  source_id: string | null;
  farm_id: string;
  farm_name: string;
  field_id: string | null;
  field_name: string;
  crop_occurrence_id: string | null;
  crop_name: string | null;
  title: string;
  subtitle: string;
  description: string;
  event_type: CalendarEventType;
  start_date: string; // YYYY-MM-DD in farm timezone
  end_date: string; // YYYY-MM-DD in farm timezone (>= start_date)
  start_at: string;
  end_at: string;
  timezone: string;
  date_basis: CalendarProvenanceBasis;
  status: CanonicalTaskStatus | 'recommended' | 'active' | 'stale' | 'observed' | 'completed';
  priority: 'high' | 'normal' | 'low' | null;
  action_button_type: 'start' | null;
  completed: boolean;
  planned_date?: string | null;
  actual_date?: string | null;
  stage_breakdown?: {
    ini: number;
    dev: number;
    mid: number;
    late: number;
  } | null;
  evidence: string[];
  links: CalendarEventLinks;
  source_version: number;
  generated_at: string;
}

export interface CalendarConflictWarning {
  id: string;
  type:
    | 'overlapping_planting'
    | 'overlapping_harvest'
    | 'same_field_multiple_ops'
    | 'stale_recommendation'
    | 'rotation_prep_gap';
  farm_id: string;
  field_id: string | null;
  date_range: { start: string; end: string };
  message: string;
  event_ids: string[];
}

export interface CalendarFreshnessSource {
  source: string;
  status: 'fresh' | 'stale' | 'unavailable';
  last_updated_at: string | null;
  retrieved_at: string;
  error?: string | null;
}

export interface FarmWeatherSummary {
  farm_id: string;
  farm_name: string;
  available: boolean;
  temp_c: number | null;
  temp_min_c: number | null;
  temp_max_c: number | null;
  wind_kmh: number | null;
  precip_mm_24h: number | null;
  forecast_precip_48h_mm: number | null;
  et0_mm_day: number | null;
  humidity_pct: number | null;
  weather_code: number | null;
  condition_label: string;
  retrieved_at: string;
  error?: string | null;
}

export interface CalendarFarmOption {
  id: string;
  name: string;
  timezone: string;
  primary_crop: string | null;
  region_label: string;
  centroid: { lat: number; lon: number } | null;
  fields: Array<{
    id: string;
    name: string;
    cropName?: string;
    status: string;
  }>;
  weather: FarmWeatherSummary;
}

export interface CalendarMonthResponse {
  farm_id: string; // farm ID or 'all'
  field_id: string | null;
  timezone: string;
  today: string;
  range: { start: string; end: string };
  events: CalendarProjectionEvent[];
  conflicts: CalendarConflictWarning[];
  workload_summary: {
    total_events: number;
    open_tasks: number;
    actionable_recommendations: number;
    completed_events: number;
  };
  farms: CalendarFarmOption[];
  weather: FarmWeatherSummary | null;
  generated_at: string;
  data_version: number;
  partial_sources: CalendarFreshnessSource[];
  sources: CalendarFreshnessSource[];
}

export interface CalendarDayGroups {
  crops_and_stages: CalendarProjectionEvent[];
  planned_work: CalendarProjectionEvent[];
  tasks_due: CalendarProjectionEvent[];
  observations: CalendarProjectionEvent[];
  completed_history: CalendarProjectionEvent[];
}

export interface CalendarDayResponse {
  date: string;
  farm_id: string;
  field_id: string | null;
  timezone: string;
  groups: CalendarDayGroups;
  events: CalendarProjectionEvent[];
  conflicts: CalendarConflictWarning[];
  generated_at: string;
  data_version: number;
  partial_sources: CalendarFreshnessSource[];
}

export interface CalendarUpcomingResponse {
  farm_id: string;
  field_id: string | null;
  timezone: string;
  start_date: string;
  end_date: string;
  days: number;
  events: CalendarProjectionEvent[];
  generated_at: string;
  data_version: number;
  partial_sources: CalendarFreshnessSource[];
}

export interface TaskAuditRecord {
  id: string;
  task_id: string;
  actor_id: string;
  command: 'created' | 'edited' | 'complete' | 'defer' | 'reschedule' | 'cancel' | 'reopen';
  previous_values: Record<string, unknown> | null;
  new_values: Record<string, unknown>;
  reason: string;
  occurred_at: string;
  timezone: string;
  request_id: string | null;
}

export interface CalendarEventDetailResponse {
  event: CalendarProjectionEvent;
  canonical_record: Record<string, unknown> | null;
  audit_history: TaskAuditRecord[];
  available_commands: Array<'complete' | 'defer' | 'reschedule' | 'cancel' | 'reopen'>;
  weather: FarmWeatherSummary | null;
  data_version: number;
}

export interface DomainOutboxEvent {
  id: string;
  event_name: string;
  farm_id: string;
  field_ids: string[];
  affected_range: { start: string; end: string };
  occurred_at: string;
  version: number;
  processed: boolean;
}

export interface CalendarStreamNotification {
  event: 'CalendarProjectionUpdated';
  farm_id: string;
  affected_fields: string[];
  affected_range: { start: string; end: string };
  version: number;
  source_event: string;
}

export interface CreateCanonicalTaskRequest {
  farm_id: string;
  field_id?: string | null;
  title: string;
  due_date: string;
  task_type?: FarmTaskItem['category'] | CalendarEventType;
  priority?: 'high' | 'normal' | 'low';
  notes?: string;
  idempotency_key: string;
}

export interface CreateCanonicalTaskResponse {
  task: FarmTaskItem;
  classification: {
    inferred_category: FarmTaskItem['category'];
    inferred_field_id: string | null;
    inferred_field_name: string | null;
    inferred_crop: string | null;
    needs_field_confirmation: boolean;
  };
  conflicts: CalendarConflictWarning[];
  event: CalendarProjectionEvent;
  data_version: number;
}

export interface TaskCommandRequest {
  command: 'complete' | 'defer' | 'reschedule' | 'cancel' | 'reopen';
  reason?: string;
  new_date?: string;
  actual_at?: string;
  actor_id?: string;
}

export interface KanbanColumn {
  id: string;
  title: string;
  cards: KanbanCard[];
}

export interface KanbanCard {
  id: string;
  title: string;
  status: string;
  type: string; // 'task' | 'project' | 'session'
  metadata?: Record<string, any>;
  created_at?: string;
  updated_at?: string;
}

export interface KanbanBoard {
  columns: KanbanColumn[];
}

export interface AgentSwimlane {
  agent: string;
  idle: boolean;
  columns: KanbanColumn[];
}

export interface MoveCardInput {
  card_type: string;
  card_id: string;
  target_status: string;
}

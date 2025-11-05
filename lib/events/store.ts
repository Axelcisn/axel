import * as fs from 'fs';
import * as path from 'path';
import { EventRecord } from './types';

const DATA_ROOT = path.join(process.cwd(), 'data');
const EVENTS_DIR = path.join(DATA_ROOT, 'events');

/**
 * Persist event to /data/events/<symbol>/<B_date>-event-<id>.json (atomic write)
 */
export async function appendEvent(symbol: string, ev: EventRecord): Promise<string> {
  const symbolDir = path.join(EVENTS_DIR, symbol);
  const filename = `${ev.B_date}-event-${ev.id}.json`;
  const filePath = path.join(symbolDir, filename);
  
  // Ensure directory exists
  await fs.promises.mkdir(symbolDir, { recursive: true });
  
  // Atomic write: write to temp file then rename
  const tempPath = `${filePath}.tmp`;
  await fs.promises.writeFile(tempPath, JSON.stringify(ev, null, 2));
  await fs.promises.rename(tempPath, filePath);
  
  return filePath;
}

/**
 * Read /data/events/<symbol>/*.json sorted by B_date
 */
export async function listEvents(symbol: string): Promise<EventRecord[]> {
  const symbolDir = path.join(EVENTS_DIR, symbol);
  
  try {
    const files = await fs.promises.readdir(symbolDir);
    const eventFiles = files
      .filter(f => f.match(/^\d{4}-\d{2}-\d{2}-event-.+\.json$/))
      .sort();
    
    const events: EventRecord[] = [];
    for (const file of eventFiles) {
      try {
        const filePath = path.join(symbolDir, file);
        const content = await fs.promises.readFile(filePath, 'utf-8');
        const event = JSON.parse(content) as EventRecord;
        events.push(event);
      } catch (err) {
        console.warn(`Failed to load event ${file}:`, err);
      }
    }
    
    return events;
  } catch (error) {
    return [];
  }
}

/**
 * Return the last event where event_open === true, else null
 */
export async function getOpenEvent(symbol: string): Promise<EventRecord | null> {
  const events = await listEvents(symbol);
  
  // Sort by B_date descending and find first open event
  const sortedEvents = events.sort((a, b) => b.B_date.localeCompare(a.B_date));
  
  for (const event of sortedEvents) {
    if (event.event_open) {
      return event;
    }
  }
  
  return null;
}
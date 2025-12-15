import { TargetSpec } from '../types/targetSpec';

export async function getTargetSpec(symbol: string): Promise<TargetSpec | null> {
  const filename = `${symbol}-target.json`;
  const url = `/data/specs/${filename}`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json() as TargetSpec;
  } catch (error) {
    // File doesn't exist or is invalid
    return null;
  }
}

export async function saveTargetSpec(input: TargetSpec): Promise<TargetSpec> {
  // NOTE: In production with static files, we can't save new specs.
  // This would need to be handled via an API endpoint that stores data elsewhere
  // (like a database or external storage service)
  
  if (process.env.NODE_ENV === 'development') {
    console.warn('saveTargetSpec: Writing to static files not supported in production');
  }
  
  // Add updated timestamp for consistency
  const targetSpec: TargetSpec = {
    ...input,
    updated_at: new Date().toISOString()
  };
  
  return targetSpec;
}

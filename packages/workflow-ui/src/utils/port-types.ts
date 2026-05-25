/**
 * Port type compatibility for edge connections.
 */

export type PortType = "string" | "number" | "boolean" | "object" | "array" | "any";

export function portsCompatible(sourceType: string, targetType: string): boolean {
  if (sourceType === "any" || targetType === "any") return true;
  return sourceType === targetType;
}

export function getPortType(
  ports: Array<{ id: string; type: string }> | undefined,
  portId: string | null | undefined
): string {
  if (!ports || !portId) return "any";
  const port = ports.find((p) => p.id === portId);
  return port?.type ?? "any";
}

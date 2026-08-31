export async function runTool(name, input = "") {
  const response = await fetch("/api/tool", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ name, input })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Tool failed");
  return data;
}
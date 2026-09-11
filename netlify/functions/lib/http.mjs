export const jsonResponse = (value, status = 200) => new Response(JSON.stringify(value, null, 2), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' },
});

export const errorResponse = (error, status = 500) => jsonResponse({
  error: error?.message || String(error || '伺服器錯誤'),
}, status);

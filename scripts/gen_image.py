import base64, sys
from google import genai

client = genai.Client()  # reads GEMINI_API_KEY from your shell
prompt, out = sys.argv[1], sys.argv[2]
r = client.interactions.create(
    model="gemini-nano-banana-2.1",
    input=prompt,
    response_format={"type": "image", "mime_type": "image/png", "aspect_ratio": "16:9", "image_size": "1K"},
)
open(out, "wb").write(base64.b64decode(r.output_image.data))
print(f"Saved {out}")

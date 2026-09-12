"""Strict, reproducible patch for the installed Open WebUI 0.11.3 source."""
from pathlib import Path
import py_compile
import shutil
import sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else '/app/backend/open_webui')
marker = '# router-terminal-policy-v1'

def change(text, old, new, count=1):
    if text.count(old) != count:
        raise RuntimeError(f'Open WebUI source drift: expected {count} occurrences of {old[:90]!r}; got {text.count(old)}')
    return text.replace(old, new)

response = root / 'utils/response.py'
middleware = root / 'utils/middleware.py'
if marker in response.read_text() and marker in middleware.read_text():
    print('Router terminal patch already installed')
    sys.exit(0)
r = response.read_text()
r = 'from open_webui.utils.router_completion import apply_terminal, guarded_native_stream\n' + marker + '\n' + r
r = change(r, '    return response\n\n\nasync def convert_streaming_response_ollama_to_openai', '    return apply_terminal(ollama_response, response, bool(openai_tool_calls))\n\n\nasync def _convert_streaming_response_ollama_to_openai')
r = change(r, "        data = openai_chat_chunk_message_template(\n", "        original_payload = data\n        data = openai_chat_chunk_message_template(\n")
r = change(r, "        line = f'data: {JSONCodec.dumps(data)}\\n\\n'", "        data = apply_terminal(original_payload, data, has_tool_calls)\n        line = f'data: {JSONCodec.dumps(data)}\\n\\n'")
r = change(r, '\ndef convert_embedding_response_ollama_to_openai', '\nasync def convert_streaming_response_ollama_to_openai(response):\n    async for line in guarded_native_stream(response, _convert_streaming_response_ollama_to_openai):\n        yield line\n\n\ndef convert_embedding_response_ollama_to_openai')
m = middleware.read_text()
# Insert after __future__ if one ever exists (none in the qualified source).
m = 'from open_webui.utils.router_completion import incomplete_fields, finalize_items, ROUTER_MODELS\n' + marker + '\n' + m
m = change(m, "            async def emit_message_error(error_content):\n                if save_to_chat:", "            async def emit_message_error(error_content):\n                if router_state:\n                    router_state.update(status='incomplete', stop_reason=router_state.get('stop_reason') if router_state.get('status') == 'incomplete' else 'client_processing_error')\n                if save_to_chat:")
m = change(m, "and retries < MAX_RETRIES:", "and (router_state or retries < MAX_RETRIES):")
m = change(m, "            usage = None\n            last_response_id = None", "            usage = None\n            router_state = {'status': 'in_progress'} if model_id in ROUTER_MODELS else {}\n            last_response_id = None")
m = change(m, "                            if data:\n                                if 'event' in data", "                            if data:\n                                if data.get('x_router'):\n                                    router_state.update(data['x_router'])\n                                    if router_state.get('status') == 'incomplete':\n                                        await emit_message_error(incomplete_fields(router_state)['error']['content'])\n                                if 'event' in data")
m = change(m, "                                parts[-1]['text'] = parts[-1]['text'].strip()", "                                if not router_state:\n                                    parts[-1]['text'] = parts[-1]['text'].strip()")
m = change(m, "                    if response_tool_calls:\n                        for tc in response_tool_calls:", "                    if router_state and router_state.get('status') != 'completed':\n                        finalize_items(output, router_state)\n                        await emit_message_error(incomplete_fields(router_state)['error']['content'])\n                        return\n\n                    if response_tool_calls:\n                        for tc in response_tool_calls:")
m = change(m, "                current_output = full_output()\n                title =", "                current_output = finalize_items(full_output(), router_state)\n                title =")
m = change(m, "                    'output': current_output,\n                    'title': title,", "                    'output': current_output,\n                    **incomplete_fields(router_state),\n                    'title': title,")
m = change(m, "                            'output': current_output,\n                            **({'usage': usage}", "                            'output': current_output,\n                            **incomplete_fields(router_state),\n                            **({'usage': usage}")
m = change(m, "                async def save_cancelled_state():\n                    await event_emitter", "                async def save_cancelled_state():\n                    if router_state:\n                        router_state.update(status='incomplete', stop_reason='cancelled')\n                        finalize_items(full_output(), router_state)\n                        await emit_message_error(incomplete_fields(router_state)['error']['content'])\n                    await event_emitter")
m = change(m, "                                'done': True,\n                                'output': full_output(),\n", "                                'done': True,\n                                'output': full_output(),\n                                **incomplete_fields(router_state),\n")
# Non-streaming: preserve reasoning-only fragments and incomplete item states.
m = change(m, "            if choices and (content or response_output):\n                if content or response_output:", "            router_state = response_data.get('x_router') or {}\n            if choices and (content or response_output or router_state):\n                if content or response_output or router_state:")
m = change(m, "                    await event_emitter(\n                        {\n                            'type': 'chat:completion',\n                            'data': {\n                                'done': True,\n                                'output': response_output,", "                    finalize_items(response_output, router_state)\n                    await event_emitter(\n                        {\n                            'type': 'chat:completion',\n                            'data': {\n                                'done': True,\n                                **incomplete_fields(router_state),\n                                'output': response_output,")
m = change(m, "                                'role': 'assistant',\n                                'output': response_output,", "                                'role': 'assistant',\n                                **incomplete_fields(router_state),\n                                'output': response_output,")
# Compaction summaries are generated output too; no invented 1000-token quota.
cpath = root / 'utils/context_compaction.py'
c = cpath.read_text()
c = change(c, "models[task_model_id].get('info', {}).get('params', {}).get('max_tokens', 1000)", "models[task_model_id].get('info', {}).get('params', {}).get('max_tokens')")
c = change(c, "    payload = {\n        'model': task_model_id,", "    task_model_params = {key: value for key, value in task_model_params.items() if value is not None}\n\n    payload = {\n        'model': task_model_id,")
c = change(c, "    parts = [previous_summary] if previous_summary else []", "    raise ValueError('Context compaction returned no complete visible summary; original messages are retained')\n\n    parts = [previous_summary] if previous_summary else []")
c = change(c, "    choices = response.get('choices') or []", "    if response.get('error') or (response.get('x_router') and response['x_router'].get('status') != 'completed'):\n        raise ValueError('Context summary is incomplete; original messages are retained')\n    choices = response.get('choices') or []")
compile(c, str(cpath), 'exec')
tpath = root / 'routers/tasks.py'
t = tpath.read_text()
t = change(t, "models[task_model_id].get('info', {}).get('params', {}).get('max_tokens', 1000)", "models[task_model_id].get('info', {}).get('params', {}).get('max_tokens')")
t = change(t, "task_model_id, _ = await get_task_model_generation_config(model_id, models)", "task_model_id, task_model_params = await get_task_model_generation_config(model_id, models)")
t = change(t, "apply_task_model_params(payload, models, task_model_id, {'max_tokens': 4})", "apply_task_model_params(payload, models, task_model_id, task_model_params)")
compile(t, str(tpath), 'exec')
# Compile both before mutation.
compile(r, str(response), 'exec'); compile(m, str(middleware), 'exec')
shutil.copyfile(Path(__file__).with_name('router_completion.py'), root / 'utils/router_completion.py')
response.write_text(r); middleware.write_text(m); cpath.write_text(c); tpath.write_text(t)
print('Installed router terminal-state preservation')

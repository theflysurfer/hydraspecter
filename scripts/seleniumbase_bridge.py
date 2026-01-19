#!/usr/bin/env python3
"""
SeleniumBase Bridge for HydraSpecter
Communicates via JSON lines over stdio.
"""

import json
import sys
import os
import traceback

def main():
    # Environment config
    profile_dir = os.environ.get('HYDRA_PROFILE_DIR', '')
    headless = os.environ.get('HYDRA_HEADLESS', 'false').lower() == 'true'
    proxy = os.environ.get('HYDRA_PROXY', '')
    window_size = os.environ.get('HYDRA_WINDOW_SIZE', '1280,720')
    window_position = os.environ.get('HYDRA_WINDOW_POSITION', '')

    driver = None

    def send_response(cmd_id, success, data=None, error=None):
        response = {'id': cmd_id, 'success': success}
        if data is not None:
            response['data'] = data
        if error is not None:
            response['error'] = error
        print(json.dumps(response), flush=True)

    def init_driver(params):
        nonlocal driver
        from seleniumbase import Driver

        # Parse window size
        ws = params.get('windowSize', {})
        width = ws.get('width', 1280)
        height = ws.get('height', 720)

        # UC mode options
        driver = Driver(
            uc=True,  # Undetected Chrome mode
            headless=params.get('headless', False),
            user_data_dir=params.get('profileDir'),
            proxy=params.get('proxy') or None,
        )

        # Set window size
        driver.set_window_size(width, height)

        # Set window position if specified
        wp = params.get('windowPosition')
        if wp:
            driver.set_window_position(wp.get('x', 0), wp.get('y', 0))

        return True

    def navigate(params):
        url = params.get('url')
        if not url:
            raise ValueError('URL required')
        driver.uc_open_with_reconnect(url, reconnect_time=3)
        return True

    def click(params):
        selector = params.get('selector')
        uc_click = params.get('ucClick', True)
        if not selector:
            raise ValueError('Selector required')

        if uc_click:
            # UC click avoids detection
            driver.uc_click(selector)
        else:
            driver.click(selector)
        return True

    def type_text(params):
        selector = params.get('selector')
        text = params.get('text')
        if not selector or text is None:
            raise ValueError('Selector and text required')

        if params.get('clear', False):
            driver.clear(selector)

        driver.type(selector, text)
        return True

    def fill(params):
        selector = params.get('selector')
        value = params.get('value')
        if not selector or value is None:
            raise ValueError('Selector and value required')

        driver.clear(selector)
        driver.type(selector, value)
        return True

    def screenshot(params):
        import base64
        # Take screenshot and return as base64
        png_data = driver.get_screenshot_as_png()
        return base64.b64encode(png_data).decode('utf-8')

    def snapshot(params):
        format_type = params.get('format', 'html')
        if format_type == 'html':
            return {'content': driver.page_source, 'format': 'html'}
        else:
            return {'content': driver.get_page_source(), 'format': 'text'}

    def evaluate(params):
        script = params.get('script')
        if not script:
            raise ValueError('Script required')
        return driver.execute_script(script)

    def wait_element(params):
        selector = params.get('selector')
        timeout = params.get('timeout', 10)
        if not selector:
            raise ValueError('Selector required')
        driver.wait_for_element(selector, timeout=timeout)
        return True

    def scroll(params):
        if 'selector' in params:
            driver.scroll_to(params['selector'])
        else:
            direction = params.get('direction', 'down')
            amount = params.get('amount', 300)
            if direction == 'down':
                driver.execute_script(f'window.scrollBy(0, {amount})')
            else:
                driver.execute_script(f'window.scrollBy(0, -{amount})')
        return True

    def close(params):
        nonlocal driver
        if driver:
            driver.quit()
            driver = None
        return True

    def get_url(params):
        return driver.current_url if driver else 'about:blank'

    def get_title(params):
        return driver.title if driver else ''

    def solve_turnstile(params):
        # Special method for Cloudflare Turnstile
        driver.uc_gui_click_captcha()
        return True

    # Command handlers
    handlers = {
        'init': init_driver,
        'navigate': navigate,
        'click': click,
        'type': type_text,
        'fill': fill,
        'screenshot': screenshot,
        'snapshot': snapshot,
        'evaluate': evaluate,
        'wait_element': wait_element,
        'scroll': scroll,
        'close': close,
        'get_url': get_url,
        'get_title': get_title,
        'solve_turnstile': solve_turnstile,
    }

    # Main loop: read JSON commands from stdin
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            cmd = json.loads(line)
            cmd_id = cmd.get('id', '')
            method = cmd.get('method', '')
            params = cmd.get('params', {})

            if method not in handlers:
                send_response(cmd_id, False, error=f'Unknown method: {method}')
                continue

            try:
                result = handlers[method](params)
                send_response(cmd_id, True, data=result)
            except Exception as e:
                send_response(cmd_id, False, error=str(e))

        except json.JSONDecodeError as e:
            sys.stderr.write(f'Invalid JSON: {e}\n')
            sys.stderr.flush()

if __name__ == '__main__':
    main()

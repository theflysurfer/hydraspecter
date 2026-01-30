"""
Manual Login Script for HydraSpecter
=====================================
Login once, sessions persist on ALL pools forever.

Usage:
    python scripts/manual-login.py [site]
    python scripts/manual-login.py google
    python scripts/manual-login.py amazon

IMPORTANT: Chrome will be closed before launching!
"""
import asyncio
import sys
import subprocess
import shutil
from pathlib import Path
from urllib.parse import urlparse

# Use patchright (patched Chromium - no Runtime.enable = no detection!)
from patchright.async_api import async_playwright

HYDRA_PROFILES = Path.home() / ".hydraspecter" / "profiles"
POOL_0 = HYDRA_PROFILES / "pool-0"

SITES = {
    "google": {
        "login_url": "https://accounts.google.com/",
        "check_url": "https://mail.google.com/",
        "success_indicator": "mail.google.com/mail"
    },
    "amazon": {
        "login_url": "https://www.amazon.fr/ap/signin",
        "check_url": "https://www.amazon.fr/gp/css/homepage.html",
        "success_indicator": "amazon.fr"
    },
    "homeexchange": {
        "login_url": "https://www.homeexchange.fr/login",
        "check_url": "https://www.homeexchange.fr/user/favorite",
        "success_indicator": "homeexchange.fr/user"
    },
    "notion": {
        "login_url": "https://www.notion.so/login",
        "check_url": "https://www.notion.so/",
        "success_indicator": "notion.so"
    },
    "github": {
        "login_url": "https://github.com/login",
        "check_url": "https://github.com/settings/profile",
        "success_indicator": "github.com/settings"
    },
    "temu": {
        "login_url": "https://www.temu.com/login.html",
        "check_url": "https://www.temu.com/bgp_user_profile.html",
        "success_indicator": "temu.com"
    },
    "hellofresh": {
        "login_url": "https://www.hellofresh.fr/login",
        "check_url": "https://www.hellofresh.fr/my-account/deliveries",
        "success_indicator": "hellofresh.fr/my-account"
    },
    "aliexpress": {
        "login_url": "https://login.aliexpress.com/",
        "check_url": "https://www.aliexpress.com/p/order/index.html",
        "success_indicator": "aliexpress.com/p/order"
    },
    "kiabi": {
        "login_url": "https://www.kiabi.com/login",
        "check_url": "https://www.kiabi.com/mon-compte",
        "success_indicator": "kiabi.com/mon-compte"
    },
    "auchan": {
        "login_url": "https://www.auchan.fr/login",
        "check_url": "https://www.auchan.fr/espace-client/profil",
        "success_indicator": "auchan.fr/espace-client"
    },
    "chronodrive": {
        "login_url": "https://www.chronodrive.com/login",
        "check_url": "https://www.chronodrive.com/mon-compte",
        "success_indicator": "chronodrive.com/mon-compte"
    },
}


def kill_chrome():
    """Kill all Chrome processes to free the profile"""
    print("\n[!] Closing Chrome processes...")
    try:
        result = subprocess.run(
            ["taskkill", "/F", "/IM", "chrome.exe"],
            capture_output=True,
            text=True,
            timeout=10
        )
        if "SUCCESS" in result.stdout or result.returncode == 0:
            print("[OK] Chrome closed")
        else:
            print("[INFO] Chrome was not running")
    except Exception as e:
        print(f"[WARN] Could not close Chrome: {e}")


def sync_to_all_pools():
    """Copy session data from pool-0 to all other pools"""
    print("\n" + "=" * 60)
    print("SYNCING TO ALL POOLS")
    print("=" * 60)

    files_to_sync = [
        "Default/Cookies",
        "Default/Local Storage",
        "Default/Session Storage",
        "Default/IndexedDB",
        "Default/Service Worker",
    ]

    synced = 0
    for i in range(1, 10):  # pool-1 to pool-9
        pool_dir = HYDRA_PROFILES / f"pool-{i}"
        pool_dir.mkdir(parents=True, exist_ok=True)

        for file_rel in files_to_sync:
            src = POOL_0 / file_rel
            dst = pool_dir / file_rel

            if src.exists():
                try:
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    if src.is_dir():
                        if dst.exists():
                            shutil.rmtree(dst)
                        shutil.copytree(src, dst)
                    else:
                        shutil.copy2(src, dst)
                    synced += 1
                except Exception as e:
                    print(f"[WARN] pool-{i}/{file_rel}: {e}")

    print(f"[OK] Synced to pools 1-9 ({synced} items)")


async def countdown(seconds: int, message: str):
    """Display countdown"""
    for i in range(seconds, 0, -1):
        print(f"\r{message} ({i}s remaining)...   ", end="", flush=True)
        await asyncio.sleep(1)
    print()


async def manual_login(site_name: str):
    """Open browser for manual login"""
    site = SITES.get(site_name.lower())
    if not site:
        print(f"Unknown site: {site_name}")
        print(f"Available: {', '.join(SITES.keys())}")
        return False

    POOL_0.mkdir(parents=True, exist_ok=True)

    print("=" * 60)
    print(f"MANUAL LOGIN: {site_name.upper()}")
    print("=" * 60)
    print(f"Profile: {POOL_0}")
    print(f"Login URL: {site['login_url']}")

    # Kill Chrome to free the profile
    kill_chrome()
    await asyncio.sleep(3)

    async with async_playwright() as p:
        # Launch with patchright's patched Chromium (no Runtime.enable detection)
        context = await p.chromium.launch_persistent_context(
            user_data_dir=str(POOL_0),
            headless=False,
            args=[
                '--disable-blink-features=AutomationControlled',
                '--disable-infobars',
                '--disable-dev-shm-usage',
                '--no-first-run',
            ],
            ignore_default_args=['--enable-automation'],
        )

        page = context.pages[0] if context.pages else await context.new_page()

        print("\n[1] Opening login page...")
        await page.goto(site["login_url"], timeout=30000)
        await asyncio.sleep(2)

        print("\n" + "=" * 40)
        print(">>> YOU HAVE 40 SECONDS TO LOGIN <<<")
        print("=" * 40)
        print(f"URL: {page.url}")

        # 40 second countdown
        await countdown(40, ">>> Login now")

        # Check if logged in
        final_url = page.url
        print(f"\n[2] Final URL: {final_url}")

        print("\nClosing browser...")
        await context.close()

    return True


async def test_persistence(site_name: str):
    """Test if session persisted"""
    site = SITES.get(site_name.lower())
    if not site:
        return False

    print("\n" + "=" * 60)
    print("TESTING PERSISTENCE")
    print("=" * 60)

    await asyncio.sleep(2)

    async with async_playwright() as p:
        context = await p.chromium.launch_persistent_context(
            user_data_dir=str(POOL_0),
            headless=False,
            args=[
                '--disable-blink-features=AutomationControlled',
                '--disable-infobars',
            ],
            ignore_default_args=['--enable-automation'],
        )

        page = context.pages[0] if context.pages else await context.new_page()

        print(f"[1] Going to {site['check_url']}...")
        await page.goto(site["check_url"], timeout=30000)
        await asyncio.sleep(3)

        # Handle Google account chooser
        if "accountchooser" in page.url:
            print("[INFO] Account chooser detected, clicking first account...")
            try:
                # Click the first account in the list
                await page.click('[data-identifier]', timeout=5000)
                await asyncio.sleep(5)
            except:
                print("[WARN] Could not click account, trying alternative...")
                try:
                    await page.click('div[data-email]', timeout=5000)
                    await asyncio.sleep(5)
                except:
                    pass

        url = page.url
        print(f"[2] Current URL: {url}")

        # Parse URL to check host (not query string)
        parsed = urlparse(url)
        url_host_path = f"{parsed.netloc}{parsed.path}"

        # Check success - verify the actual host/path, not query params
        if site["success_indicator"] in url_host_path:
            print("\n" + "=" * 40)
            print("SUCCESS! Session persisted!")
            print("=" * 40)
            success = True
        elif site_name.lower() == "google" and "mail.google.com/mail" in url_host_path:
            print("\n" + "=" * 40)
            print("SUCCESS! Gmail loaded!")
            print("=" * 40)
            success = True
        elif "accounts.google.com" in parsed.netloc or "/signin" in parsed.path or "/login" in parsed.path:
            print("\n" + "=" * 40)
            print("FAIL - Still on login page (session not saved)")
            print(f"URL: {url}")
            print("=" * 40)
            success = False
        else:
            print("\n" + "=" * 40)
            print("FAIL - Session did not persist")
            print(f"Expected: {site['success_indicator']}")
            print(f"Got: {url_host_path}")
            print("=" * 40)
            success = False

        await context.close()

    return success


async def main():
    if len(sys.argv) < 2:
        print(__doc__)
        print(f"\nAvailable sites: {', '.join(SITES.keys())}")
        return

    site_name = sys.argv[1]

    # Step 1: Manual login
    logged_in = await manual_login(site_name)

    if logged_in:
        # Step 2: Test persistence
        success = await test_persistence(site_name)

        if success:
            # Step 3: Sync to all pools
            sync_to_all_pools()

    print("\nDone! Sessions are now available in HydraSpecter on ALL pools.")


if __name__ == "__main__":
    asyncio.run(main())

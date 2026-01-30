"""
Manual Login Script for HydraSpecter
=====================================
Login once manually, sessions persist forever.

Usage:
    python scripts/manual-login.py [site]

Sites: google, amazon, notion, homeexchange, github

Example:
    python scripts/manual-login.py google
    python scripts/manual-login.py amazon
"""
import asyncio
import sys
from pathlib import Path

# Use rebrowser-playwright (same as HydraSpecter)
from playwright.async_api import async_playwright

HYDRA_PROFILES = Path.home() / ".hydraspecter" / "profiles"
POOL_0 = HYDRA_PROFILES / "pool-0"  # Auth profile

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
    "notion": {
        "login_url": "https://www.notion.so/login",
        "check_url": "https://www.notion.so/",
        "success_indicator": "notion.so"
    },
    "homeexchange": {
        "login_url": "https://www.homeexchange.fr/login",
        "check_url": "https://www.homeexchange.fr/user/favorite",
        "success_indicator": "homeexchange.fr/user"
    },
    "github": {
        "login_url": "https://github.com/login",
        "check_url": "https://github.com/settings/profile",
        "success_indicator": "github.com/settings"
    },
}


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

    async with async_playwright() as p:
        # Launch with same settings as HydraSpecter
        context = await p.chromium.launch_persistent_context(
            user_data_dir=str(POOL_0),
            headless=False,
            channel="chrome",  # Use real Chrome
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

        print("\n>>> Browser is open")
        print(">>> Login to your account")
        print(">>> When done, type 'done' and press ENTER")
        print(">>> Type 'skip' to skip this site")

        while True:
            try:
                cmd = input(">>> ").strip().lower()
                if cmd in ['done', 'skip']:
                    break
            except EOFError:
                break

        if cmd == 'skip':
            print("Skipped")
            await context.close()
            return False

        print(f"\n[2] Final URL: {page.url}")
        print("Closing browser...")
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
            channel="chrome",
            args=[
                '--disable-blink-features=AutomationControlled',
                '--disable-infobars',
            ],
            ignore_default_args=['--enable-automation'],
        )

        page = context.pages[0] if context.pages else await context.new_page()

        print(f"[1] Going to {site['check_url']}...")
        await page.goto(site["check_url"], timeout=30000)
        await asyncio.sleep(5)

        url = page.url
        print(f"[2] Current URL: {url}")

        if site["success_indicator"] in url:
            print("\n" + "=" * 40)
            print("SUCCESS! Session persisted!")
            print("=" * 40)
            success = True
        else:
            print("\n" + "=" * 40)
            print("FAIL - Session did not persist")
            print("You may need to login again")
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
        await test_persistence(site_name)

    print("\nDone! You can now use HydraSpecter with this profile.")
    print("Run: .\\scripts\\sync-pools.ps1 to sync to all pools")


if __name__ == "__main__":
    asyncio.run(main())

import api
import json
import asyncio

async def main():
    farmers = await api.get_farmers()
    with open('src/dashboard/data/farmer_db.json', 'w') as f:
        json.dump(farmers, f)

asyncio.run(main())

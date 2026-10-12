
from pathlib import Path
import pandas as pd

# Find project folders automatically
website_folder = Path(__file__).resolve().parent
project_folder = website_folder.parent
data_folder = project_folder / "Data"

# File locations
csv_path = data_folder / "blackspots.csv"
json_path = website_folder / "blackspots.json"

# Load historical blackspots
blackspots_df = pd.read_csv(csv_path)

# Select columns needed by the website
required_columns = [
    "latitude",
    "longitude",
    "collision_count",
    "total_severity_score",
    "risk_level"
]

website_blackspots = blackspots_df[
    required_columns
].copy()

# Export to JSON
website_blackspots.to_json(
    json_path,
    orient="records",
    indent=2
)

print("Blackspot JSON export completed successfully!")
print("Total historical blackspots:", len(website_blackspots))
print("Saved to:", json_path)

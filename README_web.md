# Forest Calculation Web App

## What this web app does

This Streamlit app wraps the existing forest calculation workflow and provides a simple browser-based process for:

1. Downloading the official Excel template
2. Filling survey data offline
3. Uploading the completed workbook
4. Running forest calculation automatically
5. Previewing key summary results
6. Downloading the calculated Excel output

## Required files

Keep these files in the same project directory:

- `app.py`
- `run_forest_calculation.py`
- `template.xlsx`
- `species_reference_master_v1.xlsx`
- `requirements.txt`

## Install dependencies

```bash
pip install -r requirements.txt
```

## Run the web app

```bash
streamlit run app.py
```

## Use it as a public website

The easiest way to make this tool available on a real website is to deploy it with **Streamlit Community Cloud**.

### Deployment-ready files

This project is already prepared for Streamlit deployment with:

- `app.py`
- `requirements.txt`
- `.streamlit/config.toml`
- `template.xlsx`
- `species_reference_master_v1.xlsx`

### Deploy steps

1. Create a GitHub repository
2. Upload this project folder to the repository
3. Go to [https://share.streamlit.io](https://share.streamlit.io)
4. Sign in with GitHub
5. Choose your repository
6. Set the main file path to:

```text
app.py
```

7. Click **Deploy**

After deployment, Streamlit will give you a public URL that anyone can open in a browser.

### Important deployment note

Make sure these files are committed to the repository:

- `app.py`
- `run_forest_calculation.py`
- `template.xlsx`
- `species_reference_master_v1.xlsx`
- `requirements.txt`
- `.streamlit/config.toml`

If `template.xlsx` or `species_reference_master_v1.xlsx` is missing from the deployed app, template download and calculation will not work.

## How to use the template

1. Click **Download Excel Template**
2. Fill in Tree, Sapling, Seedling, and Bamboo data offline
3. Save the workbook as `.xlsx`
4. Upload the completed workbook
5. Click **Calculate**
6. Preview the summaries and download:
   - `forest_calculation_output_summary_by_site.xlsx`
   - `forest_calculation_output_details.xlsx`

## Calculation scope

- Tree: Biomass + Volume + IVI/Shannon
- Sapling: Volume only
- Seedling: Count summary only
- Bamboo: Culm summary only

Important note:

- Biomass is calculated for Tree only
- Sapling is not included in biomass

## Notes about unmatched species

If some species cannot be matched with `species_reference_master_v1.xlsx`, the app shows them in the **Unmatched Species** preview tab so they can be reviewed before final use.

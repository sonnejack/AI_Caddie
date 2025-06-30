import pandas as pd
import plotly.graph_objects as go
import dash
from dash import dcc, html
from dash.dependencies import Input, Output
import os

# File path
input_file = '/Users/jacksonne/Python Projects/AI_Caddie/AI_Caddie/Shot_Data/Trackman_shot_data_test.xlsx'

# Error handling: Check if input file exists
if not os.path.exists(input_file):
    print(f"Error: The file '{input_file}' does not exist.")
    exit(1)

# Read the Excel file
try:
    df = pd.read_excel(input_file, sheet_name='All_Data')
except Exception as e:
    print(f"Error reading Excel file: {e}")
    exit(1)

# Define column names
carry_col = 'Carry (yards)'
side_col = 'Carry Side (ft)'
required_cols = ['Player', 'Club', 'Shot Type', carry_col, side_col]

# Error handling: Check for required columns
missing_cols = [col for col in required_cols if col not in df.columns]
if missing_cols:
    print(f"Error: Missing required columns: {', '.join(missing_cols)}")
    exit(1)

# Filter out non-numeric or NaN values
df = df.dropna(subset=[carry_col, side_col])
df = df[pd.to_numeric(df[carry_col], errors='coerce').notnull() & 
        pd.to_numeric(df[side_col], errors='coerce').notnull()]
df[carry_col] = pd.to_numeric(df[carry_col])
df[side_col] = pd.to_numeric(df[side_col])

# Create a combined tag column
df['tag'] = df['Player'] + ' - ' + df['Club'] + ' - ' + df['Shot Type']

# Initialize Dash app
app = dash.Dash(__name__)

# Layout with dropdowns on left and plot on right
app.layout = html.Div(style={'display': 'flex'}, children=[
    # Left side: Dropdowns
    html.Div([
        html.H1('Shot Dispersion'),
        html.Label('Select Player:'),
        dcc.Dropdown(
            id='player-dropdown',
            options=[{'label': 'All Players', 'value': 'All Players'}] + 
                    [{'label': player, 'value': player} for player in df['Player'].unique()],
            value='All Players',
            style={'width': '100%'}
        ),
        html.Label('Select Shot Type:', style={'marginTop': '20px'}),
        dcc.Dropdown(
            id='shot-type-dropdown',
            value='All Shot Types',
            style={'width': '100%'}
        ),
        html.Label('Select Club:', style={'marginTop': '20px'}),
        dcc.Dropdown(
            id='club-dropdown',
            value='All Clubs',
            style={'width': '100%'}
        ),
    ], style={'width': '30%', 'padding': '20px'}),
    # Right side: Plot
    html.Div([
        dcc.Graph(id='scatter-plot', style={'height': '800px', 'width': '480px'})
    ], style={'width': '70%', 'padding': '20px'})
])

# Callback to update shot type dropdown
@app.callback(
    Output('shot-type-dropdown', 'options'),
    Input('player-dropdown', 'value')
)
def update_shot_type_dropdown(selected_player):
    if selected_player == 'All Players':
        shot_types = df['Shot Type'].unique()
    else:
        shot_types = df[df['Player'] == selected_player]['Shot Type'].unique()
    return [{'label': 'All Shot Types', 'value': 'All Shot Types'}] + \
           [{'label': shot_type, 'value': shot_type} for shot_type in shot_types]

# Callback to update club dropdown
@app.callback(
    Output('club-dropdown', 'options'),
    [Input('player-dropdown', 'value'), Input('shot-type-dropdown', 'value')]
)
def update_club_dropdown(selected_player, selected_shot_type):
    filtered_df = df
    if selected_player != 'All Players':
        filtered_df = filtered_df[filtered_df['Player'] == selected_player]
    if selected_shot_type != 'All Shot Types':
        filtered_df = filtered_df[filtered_df['Shot Type'] == selected_shot_type]
    clubs = filtered_df['Club'].unique()
    return [{'label': 'All Clubs', 'value': 'All Clubs'}] + \
           [{'label': club, 'value': club} for club in clubs]

# Callback to update the plot
@app.callback(
    Output('scatter-plot', 'figure'),
    [Input('player-dropdown', 'value'), 
     Input('shot-type-dropdown', 'value'), 
     Input('club-dropdown', 'value')]
)
def update_plot(selected_player, selected_shot_type, selected_club):
    # Filter data
    filtered_df = df
    if selected_player != 'All Players':
        filtered_df = filtered_df[filtered_df['Player'] == selected_player]
    if selected_shot_type != 'All Shot Types':
        filtered_df = filtered_df[filtered_df['Shot Type'] == selected_shot_type]
    if selected_club != 'All Clubs':
        filtered_df = filtered_df[filtered_df['Club'] == selected_club]
    
    # Create traces
    traces = []
    for tag in filtered_df['tag'].unique():
        tag_df = filtered_df[filtered_df['tag'] == tag]
        trace = go.Scatter(
            x=tag_df[side_col],
            y=tag_df[carry_col],
            mode='markers',
            name=tag,
            marker=dict(symbol='circle', size=8, color='blue'),
            hovertext=[
                f"{tag}<br>Carry: {row[carry_col]:.0f} yd<br>Side: {row[side_col]:.0f} ft<br>Height: {row['Height (ft)']:.1f} ft"
                for _, row in tag_df.iterrows()
            ],
            hoverinfo='text'
        )
        traces.append(trace)
    
    # Set y-axis range
    y_max = filtered_df[carry_col].max() * 1.1 if not filtered_df.empty else 100
    
    # Create figure with conditional background
    return {
        'data': traces,
        'layout': {
            'xaxis': {'title': 'Carry Side (ft)', 'range': [-25, 25]},
            'yaxis': {'title': 'Carry Distance (yards)', 'range': [0, y_max]},
            'title': f'Shot Dispersion for {selected_player} - {selected_shot_type} - {selected_club}',
            'showlegend': True,
            'legend': {'orientation': 'h', 'yanchor': 'bottom', 'y': -0.3, 'xanchor': 'center', 'x': 0.5},
            'shapes': [
                # Dark green background for x < -25
                {
                    'type': 'rect',
                    'xref': 'x',
                    'yref': 'paper',
                    'x0': -1000,  # Extend far left
                    'x1': -25,
                    'y0': 0,
                    'y1': 1,
                    'fillcolor': '#006747',
                    'opacity': 1,
                    'layer': 'below',
                    'line': {'width': 0}
                },
                # Light green background for -25 <= x <= 25
                {
                    'type': 'rect',
                    'xref': 'x',
                    'yref': 'paper',
                    'x0': -25,
                    'x1': 25,
                    'y0': 0,
                    'y1': 1,
                    'fillcolor': '#BEE3BA',
                    'opacity': 1,
                    'layer': 'below',
                    'line': {'width': 0}
                },
                # Dark green background for x > 25
                {
                    'type': 'rect',
                    'xref': 'x',
                    'yref': 'paper',
                    'x0': 25,
                    'x1': 1000,  # Extend far right
                    'y0': 0,
                    'y1': 1,
                    'fillcolor': '#006747',
                    'opacity': 1,
                    'layer': 'below',
                    'line': {'width': 0}
                },
                # Vertical dashed line at x=0
                {
                    'type': 'line',
                    'x0': 0,
                    'x1': 0,
                    'y0': 0,
                    'y1': y_max,
                    'line': {'color': 'gray', 'dash': 'dash'}
                }
            ]
        }
    }

# Run the app
if __name__ == '__main__':
    app.run(debug=True)
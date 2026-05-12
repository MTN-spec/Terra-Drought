import torch
import torch.nn as nn
import torch.nn.functional as F

class DroughtHybridModel(nn.Module):
    def __init__(self, temporal_input_dim, spatial_input_channels=3, hidden_dim=64):
        super(DroughtHybridModel, self).__init__()
        
        # 1. Spatial Branch (CNN)
        # Assumes input images resized to 128x128
        self.spatial_cnn = nn.Sequential(
            nn.Conv2d(spatial_input_channels, 16, kernel_size=3, padding=1),
            nn.ReLU(),
            nn.MaxPool2d(2), # 64x64
            nn.Conv2d(16, 32, kernel_size=3, padding=1),
            nn.ReLU(),
            nn.MaxPool2d(2), # 32x32
            nn.Conv2d(32, 64, kernel_size=3, padding=1),
            nn.ReLU(),
            nn.AdaptiveAvgPool2d((1, 1)), # Global Average Pooling
            nn.Flatten() # Output size: 64
        )
        
        # 2. Temporal Branch (LSTM)
        # Input shape: (batch, seq_len, temporal_input_dim)
        self.temporal_lstm = nn.LSTM(
            input_size=temporal_input_dim,
            hidden_size=hidden_dim,
            num_layers=2,
            batch_first=True,
            dropout=0.2
        )
        
        # 3. Fusion Head
        # Concatenate 64 (CNN) + 64 (LSTM hidden)
        self.fusion_layer = nn.Linear(64 + hidden_dim, hidden_dim)
        self.output_layer = nn.Linear(hidden_dim, 1) # Predicting VHI
        
    def forward(self, x_spatial, x_temporal):
        # x_spatial: (batch, channels, H, W)
        # x_temporal: (batch, seq_len, features)
        
        # Extract Spatial Features
        spatial_feat = self.spatial_cnn(x_spatial)
        
        # Extract Temporal Features (Take the last hidden state)
        lstm_out, (h_n, c_n) = self.temporal_lstm(x_temporal)
        temporal_feat = h_n[-1] # Shape: (batch, hidden_dim)
        
        # Fusion
        combined = torch.cat((spatial_feat, temporal_feat), dim=1)
        x = F.relu(self.fusion_layer(combined))
        vhi_pred = self.output_layer(x)
        
        return vhi_pred

if __name__ == "__main__":
    # Test with dummy data
    model = DroughtHybridModel(temporal_input_dim=10)
    img = torch.randn(1, 3, 128, 128)
    seq = torch.randn(1, 12, 10) # 12 months sequence
    output = model(img, seq)
    print(f"Output shape: {output.shape}")

package com.chris.unbacd.web;

import android.app.Activity;
import android.content.SharedPreferences;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.InputFilter;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {

    private static final long   TICK_INTERVAL_MS  = 30_000L;
    private static final long   STALE_AFTER_MS    = 15 * 60_000L;
    private static final String PREFS_NAME        = "unbacd-web";
    private static final String PREF_DEVICE_TOKEN = "device-token";
    private static final String WEB_API_BASE      = "https://unbacd-web.vercel.app";

    // BAC thresholds
    private static final double BAC_CAUTION = 0.10;
    private static final double BAC_DANGER  = 0.15;

    // Colors
    private static final int BG_DEFAULT     = 0xff080604;
    private static final int BG_GREEN       = 0xff16a34a;
    private static final int BG_RED         = 0xffdc2626;
    private static final int BG_DANGER_BLUE = 0xff1e40af;
    private static final int COLOR_SOBER    = 0xff9ca3af;
    private static final int COLOR_ACCENT   = 0xffffd166;

    private final Handler         handler  = new Handler(Looper.getMainLooper());
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    // State
    private double  currentBac       = -1.0;
    private long    generatedAt      = 0L;
    private long    timeUntilSoberMs = 0L;
    private int     drinkCount       = 0;
    private String  userName         = "";
    private long    updatedAt        = 0L;
    private boolean syncRequestSent  = false;
    private boolean pollInFlight     = false;
    private String  deviceToken      = null;

    // Flash state for danger zone (BAC >= 0.15)
    private boolean isFlashing = false;
    private boolean flashPhase = false;
    private final Handler flashHandler = new Handler(Looper.getMainLooper());
    private final Runnable flashRunnable = new Runnable() {
        @Override public void run() {
            if (!isFlashing) return;
            rootLayout.setBackgroundColor(flashPhase ? BG_DANGER_BLUE : BG_RED);
            flashPhase = !flashPhase;
            flashHandler.postDelayed(this, 500);
        }
    };

    // Views
    private FrameLayout rootLayout;
    private TextView titleText;
    private TextView bacNumberText;
    private TextView bacLabelText;
    private TextView soberTimeText;
    private TextView drinkCountText;
    private TextView handleText;
    private TextView updatedText;
    private TextView staleText;
    private TextView doNotDriveText;
    private FrameLayout pairingOverlay;
    private EditText pinEditText;

    private final Runnable ticker = new Runnable() {
        @Override
        public void run() {
            refreshTickedViews();
            handler.postDelayed(this, TICK_INTERVAL_MS);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(
                WindowManager.LayoutParams.FLAG_FULLSCREEN,
                WindowManager.LayoutParams.FLAG_FULLSCREEN);

        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        deviceToken = prefs.getString(PREF_DEVICE_TOKEN, null);

        buildUi();

        if (deviceToken == null) {
            showPairingOverlay();
        } else {
            showNoData();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        handler.post(ticker);
    }

    @Override
    protected void onPause() {
        handler.removeCallbacks(ticker);
        isFlashing = false;
        flashHandler.removeCallbacks(flashRunnable);
        super.onPause();
    }

    // ── Polling ──────────────────────────────────────────────────────────────

    private void pollWebApi() {
        if (deviceToken == null || pollInFlight) return;
        pollInFlight = true;
        executor.execute(() -> {
            try {
                URL url = new URL(WEB_API_BASE + "/api/bac?device=" + deviceToken);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("GET");
                conn.setConnectTimeout(10_000);
                conn.setReadTimeout(10_000);
                int code = conn.getResponseCode();

                if (code == 404) {
                    // Device token no longer valid — force re-pair
                    handler.post(() -> {
                        deviceToken = null;
                        getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit()
                                .remove(PREF_DEVICE_TOKEN).apply();
                        showPairingOverlay();
                    });
                    return;
                }

                if (code == 200) {
                    BufferedReader br = new BufferedReader(
                            new InputStreamReader(conn.getInputStream()));
                    StringBuilder sb = new StringBuilder();
                    String line;
                    while ((line = br.readLine()) != null) sb.append(line);
                    br.close();
                    String json = sb.toString();
                    handler.post(() -> applyWebPayload(json));
                }
            } catch (Exception ignored) {
            } finally {
                pollInFlight = false;
            }
        });
    }

    private void applyWebPayload(String json) {
        try {
            JSONObject obj = new JSONObject(json);
            currentBac       = obj.optDouble("bac", -1.0);
            timeUntilSoberMs = obj.optLong("soberMs", 0L);
            drinkCount       = obj.optInt("drinkCount", 0);
            userName         = obj.optString("username", "");
            generatedAt      = obj.optLong("calculatedAt", System.currentTimeMillis());
            updatedAt        = System.currentTimeMillis();
            syncRequestSent  = false;
            refreshAll();
        } catch (Exception ignored) {}
    }

    // ── Pairing ──────────────────────────────────────────────────────────────

    private void showPairingOverlay() {
        pairingOverlay.setVisibility(View.VISIBLE);
        rootLayout.setBackgroundColor(BG_DEFAULT);
    }

    private void hidePairingOverlay() {
        pairingOverlay.setVisibility(View.GONE);
    }

    private void submitPin(String rawPin) {
        String pin = rawPin.trim().toUpperCase();
        if (pin.length() != 6) {
            Toast.makeText(this, "Enter 6-char PIN", Toast.LENGTH_SHORT).show();
            return;
        }
        String deviceId = Settings.Secure.getString(
                getContentResolver(), Settings.Secure.ANDROID_ID);
        executor.execute(() -> {
            try {
                URL url = new URL(WEB_API_BASE + "/api/pair");
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("PUT");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setDoOutput(true);
                conn.setConnectTimeout(10_000);
                conn.setReadTimeout(10_000);
                String body = "{\"pin\":\"" + pin + "\",\"deviceId\":\"" + deviceId + "\"}";
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(body.getBytes("UTF-8"));
                }
                int code = conn.getResponseCode();
                if (code == 200) {
                    BufferedReader br = new BufferedReader(
                            new InputStreamReader(conn.getInputStream()));
                    StringBuilder sb = new StringBuilder();
                    String line;
                    while ((line = br.readLine()) != null) sb.append(line);
                    br.close();
                    JSONObject resp = new JSONObject(sb.toString());
                    String token = resp.optString("deviceToken", "");
                    if (!token.isEmpty()) {
                        handler.post(() -> {
                            deviceToken = token;
                            getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit()
                                    .putString(PREF_DEVICE_TOKEN, token).apply();
                            hidePairingOverlay();
                            showNoData();
                            pollWebApi();
                        });
                    } else {
                        handler.post(() -> Toast.makeText(
                                this, "Invalid response", Toast.LENGTH_SHORT).show());
                    }
                } else {
                    handler.post(() -> Toast.makeText(
                            this, "Wrong PIN or expired", Toast.LENGTH_SHORT).show());
                }
            } catch (Exception e) {
                handler.post(() -> Toast.makeText(
                        this, "Connection error", Toast.LENGTH_SHORT).show());
            }
        });
    }

    // ── Display ──────────────────────────────────────────────────────────────

    private void showNoData() {
        titleText.setText("un'bac'd");
        bacNumberText.setText("—");
        bacLabelText.setText("WAITING");
        soberTimeText.setText("Waiting for data\u2026");
        drinkCountText.setText("");
        handleText.setText("");
        updatedText.setText("");
        staleText.setVisibility(View.GONE);
        applyTheme(-1.0);
    }

    private void refreshAll() {
        if (currentBac < 0) { showNoData(); return; }
        titleText.setText("un'bac'd");
        bacNumberText.setText(String.format(java.util.Locale.US, "%.3f", currentBac));
        bacLabelText.setText(bacLabel(currentBac));
        applyTheme(currentBac);
        refreshTickedViews();
    }

    private void refreshTickedViews() {
        if (deviceToken == null) return;
        if (currentBac < 0) {
            pollWebApi();
            return;
        }

        long nowMs = System.currentTimeMillis();

        // Decay sober time from calculatedAt snapshot
        long elapsedSinceGenMs = nowMs - generatedAt;
        long soberInMs = timeUntilSoberMs - elapsedSinceGenMs;
        if (currentBac < 0.001) {
            soberTimeText.setVisibility(View.GONE);
        } else if (soberInMs <= 0 || currentBac < 0.005) {
            soberTimeText.setVisibility(View.VISIBLE);
            soberTimeText.setText("Sober now");
        } else {
            soberTimeText.setVisibility(View.VISIBLE);
            soberTimeText.setText("Sober in " + formatDuration(soberInMs));
        }

        drinkCountText.setText(drinkCount == 0 ? "No drinks recorded" :
                drinkCount + (drinkCount == 1 ? " drink" : " drinks") + " \u00b7 8h window");

        handleText.setText(userName.isEmpty() ? "" : "@" + userName);

        if (updatedAt > 0) {
            updatedText.setText("Updated " + formatAgo(nowMs - updatedAt));
        }

        boolean isStale = updatedAt > 0 && (nowMs - updatedAt) > STALE_AFTER_MS;
        staleText.setVisibility(isStale ? View.VISIBLE : View.GONE);

        if (isStale && !syncRequestSent) {
            syncRequestSent = true;
            pollWebApi();
        }
        if (!isStale) syncRequestSent = false;

        // Regular poll on every tick
        pollWebApi();
    }

    // ── Theme ─────────────────────────────────────────────────────────────────

    private int bacBgColor(double bac) {
        if (bac < 0.001)       return BG_DEFAULT;
        if (bac < BAC_CAUTION) return BG_GREEN;
        return BG_RED;
    }

    private void applyTheme(double bac) {
        boolean danger = bac >= BAC_DANGER;

        if (danger && !isFlashing) {
            isFlashing = true;
            flashPhase = false;
            flashHandler.post(flashRunnable);
        } else if (!danger) {
            isFlashing = false;
            flashHandler.removeCallbacks(flashRunnable);
        }

        doNotDriveText.setVisibility(danger ? View.VISIBLE : View.GONE);

        int bg = bac < 0 ? BG_DEFAULT : bacBgColor(bac);
        if (!danger) rootLayout.setBackgroundColor(bg);
        boolean dark = (bg == BG_DEFAULT);

        titleText.setTextColor(dark ? COLOR_ACCENT   : 0xffffffff);
        bacNumberText.setTextColor(dark ? 0xfff3f4f6  : 0xffffffff);
        soberTimeText.setTextColor(dark ? 0xfff3f4f6  : 0xffffffff);
        drinkCountText.setTextColor(dark ? 0xff9ca3af  : 0xddffffff);
        handleText.setTextColor(dark ? 0xff6b7280      : 0xaaffffff);
        updatedText.setTextColor(dark ? 0xffaaaaaa     : 0xccffffff);

        if (dark) {
            bacLabelText.setTextColor(0xff080604);
            setLabelBackground(bacLabelText, COLOR_SOBER);
        } else {
            bacLabelText.setTextColor(0xffffffff);
            setLabelBackground(bacLabelText, 0x33000000);
        }
    }

    private String bacLabel(double bac) {
        if (bac < 0.001)       return "SOBER";
        if (bac < 0.05)        return "TRACE";
        if (bac < BAC_CAUTION) return "TIPSY";
        if (bac < BAC_DANGER)  return "OVER LIMIT";
        return "DANGER";
    }

    private String formatDuration(long ms) {
        long totalMins = ms / 60_000L;
        long h = totalMins / 60;
        long m = totalMins % 60;
        if (h > 0 && m > 0) return h + "h " + m + "m";
        if (h > 0)           return h + "h";
        return m + "m";
    }

    private String formatAgo(long ms) {
        long secs = ms / 1000L;
        if (secs < 60) return secs + "s ago";
        long mins = secs / 60;
        if (mins < 60) return mins + "m ago";
        return (mins / 60) + "h ago";
    }

    // ── UI construction ───────────────────────────────────────────────────────

    private void buildUi() {
        rootLayout = new FrameLayout(this);
        rootLayout.setBackgroundColor(BG_DEFAULT);
        FrameLayout root = rootLayout;

        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER);
        col.setPadding(dp(18), dp(18), dp(18), dp(18));

        // "un'bac'd" title
        titleText = tv("un'bac'd", 11, COLOR_ACCENT, Typeface.BOLD);
        titleText.setGravity(Gravity.CENTER);
        titleText.setLetterSpacing(0.12f);
        col.addView(titleText, lp(0, 0, 0, dp(2)));

        // Big BAC number
        bacNumberText = tv("\u2014", 52, 0xfff3f4f6, Typeface.BOLD);
        bacNumberText.setGravity(Gravity.CENTER);
        bacNumberText.setIncludeFontPadding(false);
        LinearLayout.LayoutParams bacNumLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        bacNumLp.bottomMargin = dp(6);
        col.addView(bacNumberText, bacNumLp);

        // Status badge
        bacLabelText = tv("WAITING", 10, 0xff080604, Typeface.BOLD);
        bacLabelText.setGravity(Gravity.CENTER);
        bacLabelText.setLetterSpacing(0.1f);
        bacLabelText.setPadding(dp(12), dp(4), dp(12), dp(4));
        setLabelBackground(bacLabelText, COLOR_SOBER);
        col.addView(bacLabelText, centredLp(dp(4)));

        // Sober-in time
        soberTimeText = tv("Waiting for data\u2026", 13, 0xfff3f4f6, Typeface.BOLD);
        soberTimeText.setGravity(Gravity.CENTER);
        col.addView(soberTimeText, lp(dp(10), 0, 0, 0));

        // Drink count
        drinkCountText = tv("", 11, 0xff9ca3af, Typeface.NORMAL);
        drinkCountText.setGravity(Gravity.CENTER);
        col.addView(drinkCountText, lp(dp(4), 0, 0, 0));

        // Handle
        handleText = tv("", 10, 0xff6b7280, Typeface.NORMAL);
        handleText.setGravity(Gravity.CENTER);
        col.addView(handleText, lp(dp(6), 0, 0, 0));

        // Updated
        updatedText = tv("", 9, 0xff4b5563, Typeface.NORMAL);
        updatedText.setGravity(Gravity.CENTER);
        col.addView(updatedText, lp(dp(2), 0, 0, 0));

        root.addView(col, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));

        // Stale overlay
        staleText = tv("Data is stale", 11, 0xfffff8e8, Typeface.BOLD);
        staleText.setGravity(Gravity.CENTER);
        staleText.setPadding(dp(14), dp(10), dp(14), dp(10));
        staleText.setBackground(roundRect(0xcc080604, 18));
        staleText.setVisibility(View.GONE);
        FrameLayout.LayoutParams staleLp = new FrameLayout.LayoutParams(
                dp(178), FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER);
        root.addView(staleText, staleLp);

        // DO NOT DRIVE overlay (shown when BAC >= 0.15)
        doNotDriveText = tv("DO NOT DRIVE", 14, 0xffffffff, Typeface.BOLD);
        doNotDriveText.setGravity(Gravity.CENTER);
        doNotDriveText.setLetterSpacing(0.10f);
        doNotDriveText.setPadding(dp(18), dp(10), dp(18), dp(10));
        doNotDriveText.setBackground(roundRect(0xdd000000, 14));
        doNotDriveText.setVisibility(View.GONE);
        FrameLayout.LayoutParams dndLp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        dndLp.bottomMargin = dp(22);
        root.addView(doNotDriveText, dndLp);

        // "Powered by Untappd" logo
        android.widget.ImageView logoView = new android.widget.ImageView(this);
        logoView.setImageResource(R.drawable.pbu_yellow);
        logoView.setAlpha(0.45f);
        logoView.setScaleType(android.widget.ImageView.ScaleType.FIT_CENTER);
        FrameLayout.LayoutParams logoLp = new FrameLayout.LayoutParams(
                dp(84), dp(20), Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        logoLp.bottomMargin = dp(6);
        root.addView(logoView, logoLp);

        // Pairing overlay — shown when no device token stored
        pairingOverlay = new FrameLayout(this);
        pairingOverlay.setBackgroundColor(BG_DEFAULT);
        pairingOverlay.setVisibility(View.GONE);

        LinearLayout pairCol = new LinearLayout(this);
        pairCol.setOrientation(LinearLayout.VERTICAL);
        pairCol.setGravity(Gravity.CENTER);
        pairCol.setPadding(dp(20), dp(20), dp(20), dp(20));

        TextView pairTitle = tv("un'bac'd", 12, COLOR_ACCENT, Typeface.BOLD);
        pairTitle.setGravity(Gravity.CENTER);
        pairTitle.setLetterSpacing(0.12f);
        pairCol.addView(pairTitle, lp(0, dp(8), 0, 0));

        TextView pairInstr = tv("Enter PIN\nfrom web app", 11, 0xff9ca3af, Typeface.NORMAL);
        pairInstr.setGravity(Gravity.CENTER);
        pairCol.addView(pairInstr, lp(0, dp(10), 0, 0));

        pinEditText = new EditText(this);
        pinEditText.setHint("ABC123");
        pinEditText.setHintTextColor(0xff4b5563);
        pinEditText.setTextColor(COLOR_ACCENT);
        pinEditText.setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 18);
        pinEditText.setTypeface(Typeface.create(Typeface.MONOSPACE, Typeface.BOLD));
        pinEditText.setGravity(Gravity.CENTER);
        pinEditText.setInputType(InputType.TYPE_CLASS_TEXT
                | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS
                | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        pinEditText.setImeOptions(EditorInfo.IME_ACTION_DONE);
        pinEditText.setFilters(new InputFilter[]{ new InputFilter.LengthFilter(6) });
        pinEditText.setBackgroundColor(0xff1a1816);
        pinEditText.setPadding(dp(16), dp(10), dp(16), dp(10));
        LinearLayout.LayoutParams pinLp = new LinearLayout.LayoutParams(dp(130),
                LinearLayout.LayoutParams.WRAP_CONTENT);
        pinLp.gravity = Gravity.CENTER_HORIZONTAL;
        pairCol.addView(pinEditText, pinLp);

        pinEditText.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_DONE) {
                submitPin(pinEditText.getText().toString());
                return true;
            }
            return false;
        });

        Button connectBtn = new Button(this);
        connectBtn.setText("Connect");
        connectBtn.setTextColor(0xff080604);
        connectBtn.setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 12);
        connectBtn.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        connectBtn.setBackground(roundRect(COLOR_ACCENT, 999));
        connectBtn.setPadding(dp(24), dp(8), dp(24), dp(8));
        LinearLayout.LayoutParams btnLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, dp(36));
        btnLp.gravity = Gravity.CENTER_HORIZONTAL;
        btnLp.topMargin = dp(12);
        pairCol.addView(connectBtn, btnLp);

        connectBtn.setOnClickListener(v -> submitPin(pinEditText.getText().toString()));

        pairingOverlay.addView(pairCol, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));

        root.addView(pairingOverlay, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));

        setContentView(root);
    }

    // ── UI helpers ────────────────────────────────────────────────────────────

    private void setLabelBackground(TextView v, int color) {
        GradientDrawable gd = new GradientDrawable();
        gd.setShape(GradientDrawable.RECTANGLE);
        gd.setCornerRadius(dp(999));
        gd.setColor(color);
        v.setBackground(gd);
    }

    private TextView tv(String text, int spSize, int color, int style) {
        TextView t = new TextView(this);
        t.setText(text);
        t.setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, spSize);
        t.setTextColor(color);
        t.setTypeface(Typeface.create(Typeface.DEFAULT, style));
        return t;
    }

    private LinearLayout.LayoutParams lp(int topMargin, int bottomMargin, int l, int r) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        p.setMargins(l, topMargin, r, bottomMargin);
        p.gravity = Gravity.CENTER_HORIZONTAL;
        return p;
    }

    private LinearLayout.LayoutParams centredLp(int topMargin) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        p.topMargin = topMargin;
        p.gravity = Gravity.CENTER_HORIZONTAL;
        return p;
    }

    private GradientDrawable roundRect(int color, int radiusDp) {
        GradientDrawable gd = new GradientDrawable();
        gd.setShape(GradientDrawable.RECTANGLE);
        gd.setCornerRadius(dp(radiusDp));
        gd.setColor(color);
        return gd;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}

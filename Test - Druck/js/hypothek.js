(function(){
  'use strict';
  
  // --- KONFIGURATION ---
  const CONFIG = {
    MAX_LTV: 80.0,
    MAX_BURDEN: 33.34,
    RATE_STRESS: 0.05,
    RATE_OP: 0.004,
    RATE_RENO: 0.006,
    ALV_CAP: 148200,
    PENSION_AGE: 65,
    MIN_AMORT_YEARS: 1,
    DEFAULT_AMORT_YEARS: 15,
    DEATH_CAPITAL_TAX_MARKUP: 0.25,
    RESERVE_RATE: 0.10,
    INCOME_GAP_WARN_THRESHOLD: 0.10,
    DEATH_CAPITAL_WARN_THRESHOLD: 0.20
  };
  
  const RATE_MAINT = CONFIG.RATE_OP + CONFIG.RATE_RENO;
  
  // Globale Variablen
  let currentMixRate = 0.018;
  let chartP1 = null, chartP2Bar = null, chartP2Donut = null, chartP3Donut = null;
  let data = {};
  
  let riskGaps = {
    b1: { alv: 0, iv: 0, death: 0 },
    b2: { alv: 0, iv: 0, death: 0 },
    pension: { b1: 0, b2: 0, both: 0 },
    crash: 0
  };
  
  // --- HELPER FUNKTIONEN ---
  const q = sel => document.querySelector(sel);
  const qAll = sel => document.querySelectorAll(sel);
  
  const parseCHF = str => {
    if (str === null || str === undefined) return 0;
    if (typeof str === 'number') return str;
    const cleanStr = String(str).replace(/['']/g, '').replace(/[^0-9.-]/g, '');
    const result = parseFloat(cleanStr);
    return isNaN(result) ? 0 : result;
  };
  
  const fmtCHF = num => {
    return new Intl.NumberFormat('de-CH', {
      style: 'currency',
      currency: 'CHF',
      maximumFractionDigits: 0
    }).format(num || 0);
  };
  
  const fmtNumber = num => {
    return new Intl.NumberFormat('de-CH').format(num || 0).replace(/,/g, "'");
  };
  
  const getVal = (id) => {
    const el = q(id);
    return el ? parseCHF(el.value) : 0;
  };
  
  const setText = (selector, text) => {
    const el = q(selector);
    if (el) el.textContent = text;
  };
  
  const setClass = (selector, className) => {
    const el = q(selector);
    if (el) el.className = className;
  };
  
  // Semantic: Update data element value attribute
  const setDataValue = (selector, value, text) => {
    const el = q(selector);
    if (el) {
      el.setAttribute('value', value);
      el.textContent = text || fmtCHF(value);
    }
  };

  // --- HELPER: Berechne tragbare Hypothek basierend auf Einkommen ---
  function calcAffordableMortgage(income) {
    const maxYearlyBurden = income * (CONFIG.MAX_BURDEN / 100);
    const yearlyMaint = data.totalInvest * RATE_MAINT;
    const availableForInterest = maxYearlyBurden - yearlyMaint;
    return Math.max(0, availableForInterest / CONFIG.RATE_STRESS);
  }

  function calcDeathCapitalNeeded(survivorIncome) {
    const affordableMortgage = calcAffordableMortgage(survivorIncome);
    const gap = Math.max(0, data.mortgage - affordableMortgage);
    return gap * (1 + CONFIG.DEATH_CAPITAL_TAX_MARKUP);
  }

  // --- HAUPTBERECHNUNGEN ---
  function calcAll() {
    const inc1 = getVal('#b1_income');
    const inc2 = getVal('#b2_income');
    const debt1 = getVal('#b1_debt');
    const debt2 = getVal('#b2_debt');
    const ali1 = getVal('#b1_alimony');
    const ali2 = getVal('#b2_alimony');
    
    const totalIncome = inc1 + inc2;
    const totalDeductions = debt1 + debt2 + ali1 + ali2;
    const effectiveIncome = Math.max(0, totalIncome - totalDeductions);

    const sum_acc = getVal('#b1_asset_bank') + getVal('#b2_asset_bank');
    const sum_sec = getVal('#b1_asset_sec') + getVal('#b2_asset_sec');
    const sum_3a = getVal('#b1_asset_3a') + getVal('#b2_asset_3a');
    const sum_pk = getVal('#b1_asset_pk') + getVal('#b2_asset_pk');
    
    const inv_acc_total = getVal('#invest_total_hard');
    const inv_3a_total = getVal('#invest_total_3a');
    const inv_pk_total = getVal('#invest_total_pk');

    const price = getVal('#propertyPrice');
    const reno = getVal('#renovationCost');
    
    let fees = getVal('#fees_total_manual');
    if (fees === 0) {
      fees = getVal('#tax_transfer') + getVal('#fee_notary') + getVal('#fee_registry') + 
             getVal('#fee_mortgage') + getVal('#fee_3a_prefund') + getVal('#fee_pk_wef');
    }

    const totalInvest = price + reno;
    const investedSum = inv_acc_total + inv_3a_total + inv_pk_total;
    const mortgage = Math.max(0, totalInvest - investedSum);
    const ltv = totalInvest > 0 ? (mortgage / totalInvest) * 100 : 0;
    const liquidLeft = sum_acc - (inv_acc_total + fees);
    const delta80 = Math.max(0, mortgage - (totalInvest * (CONFIG.MAX_LTV / 100)));
    const cashNeeded = inv_acc_total + fees;

    setDataValue('#sum_investedCapital', investedSum);
    setDataValue('#sum_buyingFees', fees);

    const limit65 = totalInvest * 0.65;
    const hypo1 = Math.min(mortgage, limit65);
    const hypo2 = Math.max(0, mortgage - limit65);
    
    let age = 40;
    const birthEl = q('#b1_birth');
    if (birthEl && birthEl.value) {
      const birthDate = new Date(birthEl.value);
      const today = new Date();
      age = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) age--;
    }
    
    const yearsToRetirement = Math.max(CONFIG.MIN_AMORT_YEARS, CONFIG.PENSION_AGE - age);
    const amortYears = Math.min(CONFIG.DEFAULT_AMORT_YEARS, yearsToRetirement);
    
    const yearlyInterest = mortgage * CONFIG.RATE_STRESS;
    const yearlyAmort = hypo2 > 0 ? hypo2 / amortYears : 0;
    const yearlyMaint = totalInvest * RATE_MAINT;
    const yearlyTotal = yearlyInterest + yearlyAmort + yearlyMaint;
    
    const monthlyInterest = yearlyInterest / 12;
    const monthlyAmort = yearlyAmort / 12;
    const monthlyMaint = yearlyMaint / 12;
    const monthlyTotal = yearlyTotal / 12;
    
    const burden = effectiveIncome > 0 ? (yearlyTotal / effectiveIncome) * 100 : 0;
    const minIncome = yearlyTotal / (CONFIG.MAX_BURDEN / 100);
    
    data = {
      inc1, inc2, debt1, debt2, ali1, ali2,
      totalIncome, totalDeductions, effectiveIncome,
      sum_acc, sum_sec, sum_3a, sum_pk,
      inv_acc_total, inv_3a_total, inv_pk_total,
      price, reno, totalInvest, fees,
      mortgage, ltv, investedSum,
      liquidLeft, delta80, cashNeeded,
      hypo1, hypo2, amortYears,
      yearlyInterest, yearlyAmort, yearlyMaint, yearlyTotal,
      monthlyInterest, monthlyAmort, monthlyMaint, monthlyTotal,
      burden, minIncome, age, yearsToRetirement,
      tranches: [], p5_total: 0, p5_op: 0, p5_reno: 0
    };
    
    return data;
  }

  function validateInputs() {
    const errors = [];
    const availableHard = data.sum_acc + data.sum_sec;
    if (Math.round(data.inv_acc_total) > Math.round(availableHard)) {
      errors.push(`Fehler Konto: Einsatz (${fmtCHF(data.inv_acc_total)}) übersteigt verfügbares Kapital (${fmtCHF(availableHard)}).`);
    }
    if (Math.round(data.inv_3a_total) > Math.round(data.sum_3a)) {
      errors.push(`Fehler 3a: Einsatz (${fmtCHF(data.inv_3a_total)}) übersteigt verfügbares Guthaben (${fmtCHF(data.sum_3a)}).`);
    }
    if (Math.round(data.inv_pk_total) > Math.round(data.sum_pk)) {
      errors.push(`Fehler PK: Einsatz (${fmtCHF(data.inv_pk_total)}) übersteigt verfügbares Guthaben (${fmtCHF(data.sum_pk)}).`);
    }
    const hardEquity = data.inv_acc_total + data.inv_3a_total;
    const minHardEquity = data.totalInvest * 0.10;
    if (hardEquity < (minHardEquity - 1)) {
      errors.push(`Zu wenig "harte Eigenmittel": Mindestens 10% (${fmtCHF(minHardEquity)}) erforderlich.`);
    }
    if (data.totalInvest <= 0) errors.push('Bitte geben Sie einen gültigen Kaufpreis ein.');
    if (data.effectiveIncome <= 0) errors.push('Das effektive Einkommen muss positiv sein.');
    return errors;
  }

  // --- RENDERING ---
  function renderP1() {
    setDataValue('#t1_totalInvest', data.totalInvest);
    setDataValue('#t1_mortgage', data.mortgage);
    setText('#t1_ltv', `Belehnung: ${data.ltv.toFixed(1)}%`);
    setDataValue('#t1_equity', data.investedSum);
    setDataValue('#t1_fees', data.fees);
    setDataValue('#t1_cash', data.cashNeeded);
    setDataValue('#t1_delta', data.delta80);

    const mortgageKpi = q('#kpi1_mortgage');
    const liquidityKpi = q('#kpi1_liquidity');
    
    if (mortgageKpi) {
      mortgageKpi.classList.remove('ok', 'alert');
      mortgageKpi.classList.add(data.ltv <= CONFIG.MAX_LTV ? 'ok' : 'alert');
    }
    if (liquidityKpi) {
      liquidityKpi.classList.remove('ok', 'alert');
      liquidityKpi.classList.add(data.liquidLeft >= 0 ? 'ok' : 'alert');
    }

    const recBox = q('#recP1');
    const recBtn = q('#btnToPhase2');
    
    if (recBox) {
      recBox.classList.remove('ok', 'warn', 'alert');
      if (recBtn) recBtn.hidden = true;
      
      if (data.delta80 > 0) {
        recBox.classList.add('alert');
        setText('#recP1_status', 'Belehnung zu hoch');
        setText('#recP1_text', `Die maximale Belehnung von ${CONFIG.MAX_LTV}% wird überschritten. Bitte erhöhen Sie das Eigenkapital um mindestens ${fmtCHF(data.delta80)}.`);
      } else if (data.liquidLeft < 0) {
        recBox.classList.add('warn');
        setText('#recP1_status', 'Liquidität fehlt');
        setText('#recP1_text', `Es fehlen ${fmtCHF(Math.abs(data.liquidLeft))} zur Deckung.`);
      } else {
        recBox.classList.add('ok');
        setText('#recP1_status', 'Machbarkeit OK');
        setText('#recP1_text', 'Die Finanzierung ist grundsätzlich machbar.');
        if (recBtn) recBtn.hidden = false;
      }
    }
    renderChartP1();
  }

  function renderP2() {
    setDataValue('#t2_burden', data.burden, data.burden.toFixed(1) + '%');
    setDataValue('#t2_minIncome', data.minIncome);
    setDataValue('#t2_hypo1', data.hypo1);
    setDataValue('#t2_hypo2', data.hypo2);
    
    const burdenKpi = q('#kpi2_burden');
    if (burdenKpi) {
      burdenKpi.classList.remove('ok', 'alert');
      burdenKpi.classList.add(data.burden <= CONFIG.MAX_BURDEN ? 'ok' : 'alert');
    }
    
    const recBox = q('#recP2');
    if (recBox) {
      recBox.classList.remove('ok', 'warn', 'alert');
      
      if (data.burden > CONFIG.MAX_BURDEN) {
        recBox.classList.add('alert');
        setText('#recP2_status', 'Tragbarkeit kritisch');
        setText('#recP2_text', `Belastung ${data.burden.toFixed(1)}% übersteigt Maximum.`);
      } else if (data.burden > 30) {
        recBox.classList.add('warn');
        setText('#recP2_status', 'Tragbarkeit grenzwertig');
        setText('#recP2_text', `${data.burden.toFixed(1)}% - knapp unter dem Maximum.`);
      } else {
        recBox.classList.add('ok');
        setText('#recP2_status', 'Tragbarkeit OK');
        setText('#recP2_text', `Mit ${data.burden.toFixed(1)}% komfortabel unter dem Maximum.`);
      }
    }
    renderChartP2Bar();
    renderChartP2Donut();
  }

  function renderRisk() {
    const targetTxt = `Soll: ${fmtCHF(data.minIncome)}`;
    
    riskGaps = { b1: { alv: 0, iv: 0, death: 0 }, b2: { alv: 0, iv: 0, death: 0 }, pension: { b1: 0, b2: 0, both: 0 }, crash: 0 };
    
    // K1 Szenarien
    const hasKidsOrAlimony1 = getVal('#b1_kids') > 0 || getVal('#b1_alimony') > 0;
    const alvRate1 = hasKidsOrAlimony1 ? 0.8 : 0.7;
    const alvInc1 = Math.min(data.inc1, CONFIG.ALV_CAP) * alvRate1 + data.inc2;
    
    setDataValue('#val_alv', alvInc1);
    setText('#target_alv', targetTxt);
    
    const riskAlv = q('#risk_alv');
    if (data.minIncome > alvInc1) {
      riskGaps.b1.alv = data.minIncome - alvInc1;
      setDataValue('#gap_alv', riskGaps.b1.alv, `-${fmtCHF(riskGaps.b1.alv)}`);
      if (riskAlv) { riskAlv.classList.remove('ok', 'warn'); riskAlv.classList.add('alert'); }
      setText('#stat_alv', 'LÜCKE');
    } else {
      setDataValue('#gap_alv', 0, 'Keine');
      if (riskAlv) { riskAlv.classList.remove('alert', 'warn'); riskAlv.classList.add('ok'); }
      setText('#stat_alv', 'OK');
    }

    const ivInc1 = getVal('#b1_pension_inv') + data.inc2;
    setDataValue('#val_iv', ivInc1);
    setText('#target_iv', targetTxt);
    
    const riskIv = q('#risk_iv');
    if (data.minIncome > ivInc1) {
      riskGaps.b1.iv = data.minIncome - ivInc1;
      setDataValue('#gap_iv', riskGaps.b1.iv, `-${fmtCHF(riskGaps.b1.iv)}`);
      if (riskIv) { riskIv.classList.remove('ok', 'alert'); riskIv.classList.add('warn'); }
      setText('#stat_iv', 'LÜCKE');
    } else {
      setDataValue('#gap_iv', 0, 'Keine');
      if (riskIv) { riskIv.classList.remove('alert', 'warn'); riskIv.classList.add('ok'); }
      setText('#stat_iv', 'OK');
    }

    const deathInc1 = getVal('#b1_pension_death') + data.inc2;
    setDataValue('#val_death', deathInc1);
    setText('#target_death', targetTxt);
    riskGaps.b1.death = calcDeathCapitalNeeded(deathInc1);
    
    const riskDeath = q('#risk_death');
    if (riskGaps.b1.death > 0) {
      setDataValue('#gap_death', riskGaps.b1.death);
      if (riskDeath) { riskDeath.classList.remove('ok', 'warn'); riskDeath.classList.add('alert'); }
      setText('#stat_death', 'LÜCKE');
    } else {
      setDataValue('#gap_death', 0, 'Keine');
      if (riskDeath) { riskDeath.classList.remove('alert', 'warn'); riskDeath.classList.add('ok'); }
      setText('#stat_death', 'OK');
    }

    const crashMax = data.totalInvest * 0.8 * (CONFIG.MAX_LTV / 100);
    const marginCall = Math.max(0, data.mortgage - crashMax);
    riskGaps.crash = marginCall;
    
    setDataValue('#val_crash', crashMax);
    const riskCrash = q('#risk_value');
    
    if (marginCall > 0) {
      setDataValue('#gap_crash', marginCall);
      
      // Farblogik basierend auf Liquidität
      const currentLiquidity = data.liquidLeft;
      const crashThresholdGreen = marginCall * 1.1; // +10% Puffer für Grün
      
      if (riskCrash) {
        riskCrash.classList.remove('ok', 'warn', 'alert');
        if (currentLiquidity >= crashThresholdGreen) {
          riskCrash.classList.add('ok');
          setText('#stat_crash', 'GEDECKT');
        } else if (currentLiquidity >= marginCall) {
          riskCrash.classList.add('warn');
          setText('#stat_crash', 'KNAPP');
        } else {
          riskCrash.classList.add('alert');
          setText('#stat_crash', 'NACHSCHUSS');
        }
      }
    } else {
      setDataValue('#gap_crash', 0, 'Keiner');
      if (riskCrash) { riskCrash.classList.remove('alert', 'warn'); riskCrash.classList.add('ok'); }
      setText('#stat_crash', 'OK');
    }

    // K2 Szenarien
    const b2Name = q('#b2_name')?.value?.trim() || '';
    const hasB2 = data.inc2 > 0 || b2Name !== '';
    
    const riskRowB2 = q('#risk_row_b2');
    if (riskRowB2) riskRowB2.hidden = !hasB2;
    
    if (hasB2) {
      const hasKidsOrAlimony2 = getVal('#b2_kids') > 0 || getVal('#b2_alimony') > 0;
      const alvRate2 = hasKidsOrAlimony2 ? 0.8 : 0.7;
      const alvInc2 = Math.min(data.inc2, CONFIG.ALV_CAP) * alvRate2 + data.inc1;
      
      setDataValue('#val_alv_b2', alvInc2);
      setText('#target_alv_b2', targetTxt);
      
      const riskAlvB2 = q('#risk_alv_b2');
      if (data.minIncome > alvInc2) {
        riskGaps.b2.alv = data.minIncome - alvInc2;
        setDataValue('#gap_alv_b2', riskGaps.b2.alv, `-${fmtCHF(riskGaps.b2.alv)}`);
        if (riskAlvB2) { riskAlvB2.classList.remove('ok', 'warn'); riskAlvB2.classList.add('alert'); }
        setText('#stat_alv_b2', 'LÜCKE');
      } else {
        setDataValue('#gap_alv_b2', 0, 'Keine');
        if (riskAlvB2) { riskAlvB2.classList.remove('alert', 'warn'); riskAlvB2.classList.add('ok'); }
        setText('#stat_alv_b2', 'OK');
      }

      const ivInc2 = getVal('#b2_pension_inv') + data.inc1;
      setDataValue('#val_iv_b2', ivInc2);
      setText('#target_iv_b2', targetTxt);
      
      const riskIvB2 = q('#risk_iv_b2');
      if (data.minIncome > ivInc2) {
        riskGaps.b2.iv = data.minIncome - ivInc2;
        setDataValue('#gap_iv_b2', riskGaps.b2.iv, `-${fmtCHF(riskGaps.b2.iv)}`);
        if (riskIvB2) { riskIvB2.classList.remove('ok', 'alert'); riskIvB2.classList.add('warn'); }
        setText('#stat_iv_b2', 'LÜCKE');
      } else {
        setDataValue('#gap_iv_b2', 0, 'Keine');
        if (riskIvB2) { riskIvB2.classList.remove('alert', 'warn'); riskIvB2.classList.add('ok'); }
        setText('#stat_iv_b2', 'OK');
      }

      const deathInc2 = getVal('#b2_pension_death') + data.inc1;
      setDataValue('#val_death_b2', deathInc2);
      setText('#target_death_b2', targetTxt);
      riskGaps.b2.death = calcDeathCapitalNeeded(deathInc2);
      
      const riskDeathB2 = q('#risk_death_b2');
      if (riskGaps.b2.death > 0) {
        setDataValue('#gap_death_b2', riskGaps.b2.death);
        if (riskDeathB2) { riskDeathB2.classList.remove('ok', 'warn'); riskDeathB2.classList.add('alert'); }
        setText('#stat_death_b2', 'LÜCKE');
      } else {
        setDataValue('#gap_death_b2', 0, 'Keine');
        if (riskDeathB2) { riskDeathB2.classList.remove('alert', 'warn'); riskDeathB2.classList.add('ok'); }
        setText('#stat_death_b2', 'OK');
      }

      const shockRate = 0.03;
      const shockMonthly = (data.mortgage * shockRate) / 12;
      const currentMonthly = (data.mortgage * currentMixRate) / 12;
      setDataValue('#val_rate_shock', shockMonthly);
      setDataValue('#gap_rate_shock', shockMonthly - currentMonthly, `+ ${fmtCHF(shockMonthly - currentMonthly)}`);
    }

    // Pensionierung
    const pen1 = getVal('#b1_pension_old');
    const pen2 = getVal('#b2_pension_old');
    const work1 = data.inc1 - data.debt1 - data.ali1;
    const work2 = data.inc2 - data.debt2 - data.ali2;
    
    const costPension = (data.hypo1 * CONFIG.RATE_STRESS) + data.yearlyMaint;
    const targetPension = costPension / (CONFIG.MAX_BURDEN / 100);
    
    const checkPension = (income, valId, gapId, statId, targetId, gapKey) => {
      setDataValue(valId, income);
      setText(targetId, `Soll: ${fmtCHF(targetPension)}`);
      
      if (income < targetPension) {
        const maxInterest = (income * (CONFIG.MAX_BURDEN / 100)) - data.yearlyMaint;
        const maxHypo = Math.max(0, maxInterest / CONFIG.RATE_STRESS);
        const gap = Math.max(0, data.hypo1 - maxHypo);
        
        if (gap > 0) {
          riskGaps.pension[gapKey] = gap;
          setDataValue(gapId, gap);
          setText(statId, 'LÜCKE');
          const statEl = q(statId);
          if (statEl) statEl.style.background = 'var(--danger)';
        } else {
          setDataValue(gapId, 0, 'Gedeckt');
          setText(statId, 'OK');
          const statEl = q(statId);
          if (statEl) statEl.style.background = 'var(--ok)';
        }
      } else {
        setDataValue(gapId, 0, 'Gedeckt');
        setText(statId, 'OK');
        const statEl = q(statId);
        if (statEl) statEl.style.background = 'var(--ok)';
      }
    };
    
    checkPension(pen1 + work2, '#val_pen_1', '#gap_pen_1', '#stat_pen_1', '#target_pen_1', 'b1');
    checkPension(pen2 + work1, '#val_pen_2', '#gap_pen_2', '#stat_pen_2', '#target_pen_2', 'b2');
    checkPension(pen1 + pen2, '#val_pen_both', '#gap_pen_both', '#stat_pen_both', '#target_pen_both', 'both');
  }

  function getRecommendationClass(gapType, gapValue) {
    if (gapValue <= 0) return 'ok';
    if (gapType === 'income') {
      const threshold = data.effectiveIncome * CONFIG.INCOME_GAP_WARN_THRESHOLD;
      return gapValue < threshold ? 'warn' : 'alert';
    } else if (gapType === 'death') {
      const threshold = data.totalInvest * CONFIG.DEATH_CAPITAL_WARN_THRESHOLD;
      return gapValue < threshold ? 'warn' : 'alert';
    }
    return 'alert';
  }

  function renderRecommendations() {
    const b1Name = q('#b1_name')?.value?.trim() || 'Käufer 1';
    const b2Name = q('#b2_name')?.value?.trim() || 'Käufer 2';
    const hasB2 = data.inc2 > 0 || b2Name !== 'Käufer 2';
    
    let hasAnyRec = false;
    
    const recB1Grid = q('#rec_insurance_b1_grid');
    const recB1Section = q('#rec_insurance_b1');
    
    if (recB1Grid && recB1Section) {
      recB1Grid.innerHTML = '';
      let hasB1Recs = false;
      
      if (riskGaps.b1.alv > 0) {
        hasB1Recs = true;
        const colorClass = getRecommendationClass('income', riskGaps.b1.alv);
        recB1Grid.innerHTML += `<article class="rec-card ${colorClass}" role="listitem"><h4 class="rec-card-title">Arbeitslosenversicherung</h4><p class="rec-card-body">Lücke bei Arbeitslosigkeit</p><data class="rec-card-value" value="${riskGaps.b1.alv}">${fmtCHF(riskGaps.b1.alv)} / Jahr</data></article>`;
      }
      if (riskGaps.b1.iv > 0) {
        hasB1Recs = true;
        const colorClass = getRecommendationClass('income', riskGaps.b1.iv);
        recB1Grid.innerHTML += `<article class="rec-card ${colorClass}" role="listitem"><h4 class="rec-card-title">Erwerbsunfähigkeit</h4><p class="rec-card-body">Lücke bei Invalidität</p><data class="rec-card-value" value="${riskGaps.b1.iv}">${fmtCHF(riskGaps.b1.iv)} / Jahr</data></article>`;
      }
      if (riskGaps.b1.death > 0) {
        hasB1Recs = true;
        const colorClass = getRecommendationClass('death', riskGaps.b1.death);
        recB1Grid.innerHTML += `<article class="rec-card ${colorClass}" role="listitem"><h4 class="rec-card-title">Todesfallrisiko</h4><p class="rec-card-body">Benötigtes Kapital</p><data class="rec-card-value" value="${riskGaps.b1.death}">${fmtCHF(riskGaps.b1.death)}</data></article>`;
      }
      recB1Section.hidden = !hasB1Recs;
      if (hasB1Recs) hasAnyRec = true;
    }
    
    const recB2Grid = q('#rec_insurance_b2_grid');
    const recB2Section = q('#rec_insurance_b2');
    
    if (recB2Grid && recB2Section && hasB2) {
      recB2Grid.innerHTML = '';
      let hasB2Recs = false;
      
      if (riskGaps.b2.alv > 0) { hasB2Recs = true; recB2Grid.innerHTML += `<article class="rec-card ${getRecommendationClass('income', riskGaps.b2.alv)}" role="listitem"><h4 class="rec-card-title">Arbeitslosenversicherung</h4><data class="rec-card-value" value="${riskGaps.b2.alv}">${fmtCHF(riskGaps.b2.alv)} / Jahr</data></article>`; }
      if (riskGaps.b2.iv > 0) { hasB2Recs = true; recB2Grid.innerHTML += `<article class="rec-card ${getRecommendationClass('income', riskGaps.b2.iv)}" role="listitem"><h4 class="rec-card-title">Erwerbsunfähigkeit</h4><data class="rec-card-value" value="${riskGaps.b2.iv}">${fmtCHF(riskGaps.b2.iv)} / Jahr</data></article>`; }
      if (riskGaps.b2.death > 0) { hasB2Recs = true; recB2Grid.innerHTML += `<article class="rec-card ${getRecommendationClass('death', riskGaps.b2.death)}" role="listitem"><h4 class="rec-card-title">Todesfallrisiko</h4><data class="rec-card-value" value="${riskGaps.b2.death}">${fmtCHF(riskGaps.b2.death)}</data></article>`; }
      
      recB2Section.hidden = !hasB2Recs;
      if (hasB2Recs) hasAnyRec = true;
    } else if (recB2Section) {
      recB2Section.hidden = true;
    }
    
    const recCapitalGrid = q('#rec_capital_grid');
    if (recCapitalGrid) {
      recCapitalGrid.innerHTML = '';
      
      // Pensionierungslücke - Kapital das bis zur Pensionierung angespart werden muss
      const maxPensionGap = Math.max(riskGaps.pension.b1, riskGaps.pension.b2, riskGaps.pension.both);
      if (maxPensionGap > 0) {
        hasAnyRec = true;
        const yearsUntilPension = Math.max(1, CONFIG.PENSION_AGE - data.age);
        const monthlyPensionSave = Math.round(maxPensionGap / yearsUntilPension / 12);
        recCapitalGrid.innerHTML += `<article class="rec-card warn" role="listitem"><h4 class="rec-card-title">Sparziel Pensionierung</h4><p class="rec-card-body">Um die Hypothek im Alter tragbar zu halten, müssen Sie Kapital ansparen oder die Hypothek reduzieren.</p><data class="rec-card-value" value="${maxPensionGap}">${fmtCHF(maxPensionGap)}</data><p class="rec-card-hint">In ${yearsUntilPension} Jahren (ca. ${fmtCHF(monthlyPensionSave)}/Monat)</p></article>`;
      }
      
      // Margin-Call Risiko bei Immobilien-Crash
      if (riskGaps.crash > 0) {
        hasAnyRec = true;
        const currentLiquidity = data.liquidLeft;
        const crashThresholdGreen = riskGaps.crash; // Genügend Liquidität
        const crashThresholdYellow = riskGaps.crash * 1.1; // Maximal +10% Puffer
        
        let crashColorClass = 'alert'; // Rot (default)
        let crashHint = 'Empfehlung: Diesen Betrag als Reserve aufbauen';
        
        if (currentLiquidity >= crashThresholdYellow) {
          crashColorClass = 'ok'; // Grün - genügend Puffer
          crashHint = `Ihre Liquidität (${fmtCHF(currentLiquidity)}) deckt dieses Risiko ab`;
        } else if (currentLiquidity >= crashThresholdGreen) {
          crashColorClass = 'warn'; // Gelb - knapp gedeckt
          crashHint = `Ihre Liquidität (${fmtCHF(currentLiquidity)}) deckt knapp – Puffer aufbauen`;
        } else if (currentLiquidity > 0) {
          crashHint = `Ihre Liquidität (${fmtCHF(currentLiquidity)}) reicht nicht – noch ${fmtCHF(riskGaps.crash - currentLiquidity)} aufbauen`;
        }
        
        recCapitalGrid.innerHTML += `<article class="rec-card ${crashColorClass}" role="listitem"><h4 class="rec-card-title">Nachschuss-Risiko</h4><p class="rec-card-body">Bei einem Wertverlust von 20% könnte die Bank zusätzliches Kapital verlangen (Margin Call).</p><data class="rec-card-value" value="${riskGaps.crash}">${fmtCHF(riskGaps.crash)}</data><p class="rec-card-hint">${crashHint}</p></article>`;
      }
      
      // Falls keine Kapitalempfehlungen nötig
      if (recCapitalGrid.innerHTML === '') {
        recCapitalGrid.innerHTML = `<article class="rec-card ok" role="listitem"><h4 class="rec-card-title">Kapitalaufbau</h4><p class="rec-card-body">Keine zusätzlichen Sparempfehlungen</p><data class="rec-card-value" value="0">Alles OK</data></article>`;
      }
    }
    
    const recNone = q('#rec_none');
    if (recNone) recNone.hidden = hasAnyRec;
  }

  // --- CHARTS ---
  function renderChartP1() {
    const chartEl = q('#chartP1');
    if (!chartEl) return;
    const options = {
      series: [{ name: 'Eigenmittel', data: [data.investedSum] }, { name: 'Hypothek', data: [data.mortgage] }],
      chart: { type: 'bar', height: 160, stacked: true, toolbar: { show: false } },
      plotOptions: { bar: { horizontal: true } },
      colors: ['#198754', '#003366'],
      xaxis: { max: data.totalInvest * 1.1, labels: { formatter: v => fmtCHF(v) }, categories: [''] },
      yaxis: { show: false },
      tooltip: { x: { show: false }, y: { formatter: v => fmtCHF(v) } },
      dataLabels: { enabled: false },
      legend: { show: true, position: 'bottom' },
      annotations: { xaxis: [{ x: data.totalInvest * (CONFIG.MAX_LTV / 100), borderColor: '#d32f2f', label: { text: `Max ${CONFIG.MAX_LTV}%`, style: { background: '#d32f2f', color: '#fff' } } }] }
    };
    if (chartP1) chartP1.destroy();
    chartP1 = new ApexCharts(chartEl, options);
    chartP1.render();
  }

  function renderChartP2Bar() {
    const chartEl = q('#chartP2_Bar');
    if (!chartEl) return;
    const limitMonth = (data.effectiveIncome / 12) * (CONFIG.MAX_BURDEN / 100);
    const options = {
      series: [{ name: 'Zins (5%)', data: [data.monthlyInterest] }, { name: 'Amortisation', data: [data.monthlyAmort] }, { name: 'Unterhalt', data: [data.monthlyMaint] }],
      chart: { type: 'bar', height: 160, stacked: true, toolbar: { show: false } },
      plotOptions: { bar: { horizontal: true } },
      colors: ['#003366', '#673ab7', '#9e9e9e'],
      xaxis: { max: Math.max(data.monthlyTotal * 1.2, limitMonth * 1.1), labels: { formatter: v => fmtCHF(v) }, categories: [''] },
      yaxis: { show: false },
      tooltip: { x: { show: false }, y: { formatter: v => fmtCHF(v) } },
      dataLabels: { enabled: false },
      legend: { show: true, position: 'bottom' },
      annotations: { xaxis: [{ x: limitMonth, borderColor: '#d32f2f', label: { text: `Limit`, style: { background: '#d32f2f', color: '#fff' } } }] }
    };
    if (chartP2Bar) chartP2Bar.destroy();
    chartP2Bar = new ApexCharts(chartEl, options);
    chartP2Bar.render();
  }

  function renderChartP2Donut() {
    const chartEl = q('#chartP2_Donut');
    if (!chartEl) return;
    const options = {
      series: [data.monthlyInterest, data.monthlyAmort, data.monthlyMaint],
      labels: ['Zins', 'Amort.', 'Unterhalt'],
      chart: { type: 'donut', height: 180 },
      colors: ['#003366', '#673ab7', '#9e9e9e'],
      legend: { show: false },
      tooltip: { y: { formatter: v => fmtCHF(v) } },
      dataLabels: { enabled: true, formatter: v => Math.round(v) + '%' },
      plotOptions: { pie: { donut: { labels: { show: true, total: { show: true, label: 'Total', formatter: () => fmtCHF(data.monthlyTotal) } } } } }
    };
    if (chartP2Donut) chartP2Donut.destroy();
    chartP2Donut = new ApexCharts(chartEl, options);
    chartP2Donut.render();
  }

  function renderChartP3Donut(interest, opCost, renoCost) {
    const chartEl = q('#chartP3_Donut');
    if (!chartEl) return;
    const options = {
      series: [interest, data.monthlyAmort, opCost + renoCost],
      labels: ['Zins', 'Amort.', 'Unterhalt'],
      chart: { type: 'donut', height: 180 },
      colors: ['#198754', '#673ab7', '#9e9e9e'],
      legend: { show: true, position: 'bottom' },
      tooltip: { y: { formatter: v => fmtCHF(v) } },
      dataLabels: { enabled: true, formatter: v => Math.round(v) + '%' }
    };
    if (chartP3Donut) chartP3Donut.destroy();
    chartP3Donut = new ApexCharts(chartEl, options);
    chartP3Donut.render();
  }

  // --- PHASE 4 & 5 ---
  function reCalcP4() {
    let totalAmount = 0, totalInterest = 0;
    let hasTrancheError = false;
    data.tranches = [];
    
    qAll('.tranche-row').forEach(row => {
      const selectEl = row.querySelector('select');
      const amountEl = row.querySelector('.tr-amount');
      const rateEl = row.querySelector('.tr-rate');
      const warningEl = row.querySelector('.tranche-warning');
      
      if (!selectEl || !amountEl || !rateEl) return;
      
      const product = selectEl.value;
      const amount = parseCHF(amountEl.value);
      const rate = parseFloat(rateEl.value) || 0;
      const yearlyInterest = amount * (rate / 100);
      
      // Validierung: Tranche muss >= 100'000 sein (wenn > 0)
      if (amount > 0 && amount < 100000) {
        hasTrancheError = true;
        amountEl.style.borderColor = 'var(--danger)';
        amountEl.setAttribute('aria-invalid', 'true');
        if (warningEl) {
          warningEl.textContent = 'Min. CHF 100\'000';
          warningEl.hidden = false;
        }
      } else {
        amountEl.style.borderColor = '';
        amountEl.removeAttribute('aria-invalid');
        if (warningEl) warningEl.hidden = true;
      }
      
      totalAmount += amount;
      totalInterest += yearlyInterest;
      data.tranches.push({ product, amount, rate, mInt: yearlyInterest / 12 });
    });
    
    // Weiter-Button deaktivieren wenn Fehler
    const btnToP5 = q('#btnToPhase5');
    if (btnToP5) {
      btnToP5.disabled = hasTrancheError;
      btnToP5.title = hasTrancheError ? 'Bitte alle Tranchen auf mind. CHF 100\'000 setzen' : '';
    }
    
    const delta = data.mortgage - totalAmount;
    const deltaDisplay = q('#p3_deltaDisplay');
    if (deltaDisplay) {
      if (Math.abs(delta) > 10) { deltaDisplay.textContent = `Differenz: ${fmtCHF(delta)}`; deltaDisplay.style.color = '#d32f2f'; }
      else { deltaDisplay.textContent = 'Vollständig verteilt'; deltaDisplay.style.color = '#198754'; }
    }
    
    let effectiveInterest = totalInterest;
    if (delta > 0) effectiveInterest += delta * 0.025;
    
    const mixRate = data.mortgage > 0 ? effectiveInterest / data.mortgage : 0;
    currentMixRate = mixRate;
    
    const monthlyInterest = effectiveInterest / 12;
    const monthlyMaint = (data.totalInvest * RATE_MAINT) / 12;
    const monthlyTotal = monthlyInterest + data.monthlyAmort + monthlyMaint;
    
    data.p5_total = monthlyTotal;
    data.p5_op = monthlyMaint * (CONFIG.RATE_OP / RATE_MAINT);
    data.p5_reno = monthlyMaint * (CONFIG.RATE_RENO / RATE_MAINT);

    setDataValue('#p3_targetHypo', data.mortgage);
    setDataValue('#t3_monthlyTotalReal', monthlyTotal);
    setText('#t3_mixRate', `Mischzins: ${(mixRate * 100).toFixed(2)}%`);
    setDataValue('#t3_interest', monthlyInterest);
    setDataValue('#t3_amort', data.monthlyAmort);
    setDataValue('#t3_opCost', data.p5_op);
    setDataValue('#t3_renoReserve', data.p5_reno);
    
    const realBurden = (monthlyTotal * 12 / data.effectiveIncome) * 100;
    const kpi3 = q('#kpi3_total');
    if (kpi3) {
      kpi3.classList.remove('ok', 'warn');
      kpi3.classList.add(realBurden <= CONFIG.MAX_BURDEN ? 'ok' : 'warn');
    }
    
    const amortSection = q('#amortTypeSection');
    if (amortSection) {
      amortSection.hidden = data.hypo2 <= 0;
      setDataValue('#p4_amortMonthly', data.monthlyAmort);
    }
    
    updateAmortizationDisplay();
    renderChartP3Donut(monthlyInterest, data.p5_op, data.p5_reno);
  }
  
  function updateAmortizationDisplay() {
    const amortType = document.querySelector('input[name="amortType"]:checked')?.value || 'indirect';
    const mixFields = q('#amortMixFields');
    if (mixFields) mixFields.hidden = amortType !== 'mix';
    
    data.amortType = amortType;
    if (amortType === 'direct') { data.amortDirect = data.monthlyAmort; data.amort3a = 0; }
    else if (amortType === 'indirect') { data.amortDirect = 0; data.amort3a = data.monthlyAmort; }
    else { data.amortDirect = parseCHF(q('#amortDirectAmount')?.value || 0); data.amort3a = parseCHF(q('#amort3aAmount')?.value || 0); }
  }
  
  function setupAmortizationListeners() {
    qAll('input[name="amortType"]').forEach(radio => radio.addEventListener('change', updateAmortizationDisplay));
    const directInput = q('#amortDirectAmount');
    const indirectInput = q('#amort3aAmount');
    if (directInput) directInput.addEventListener('change', e => { e.target.value = fmtNumber(parseCHF(e.target.value)); updateAmortizationDisplay(); });
    if (indirectInput) indirectInput.addEventListener('change', e => { e.target.value = fmtNumber(parseCHF(e.target.value)); updateAmortizationDisplay(); });
  }

  function renderP5() {
    const grid = q('#cost_summary_grid');
    if (!grid) return;
    grid.innerHTML = '';
    
    if (data.tranches && data.tranches.length > 0) {
      data.tranches.forEach(tranche => {
        grid.innerHTML += `<figure class="kpi" role="group"><figcaption class="kpi-label">${tranche.product}</figcaption><data class="kpi-value" value="${tranche.amount}">${fmtCHF(tranche.amount)}</data><small class="kpi-sub">${tranche.rate.toFixed(2)}% (${fmtCHF(tranche.mInt)}/Mt)</small></figure>`;
      });
    }
    grid.innerHTML += `<figure class="kpi" role="group"><figcaption class="kpi-label">Amortisation</figcaption><data class="kpi-value" value="${data.monthlyAmort}">${fmtCHF(data.monthlyAmort)}</data><small class="kpi-sub">2. Hypothek</small></figure>`;
    grid.innerHTML += `<figure class="kpi" role="group"><figcaption class="kpi-label">Unterhalt & Rücklagen</figcaption><data class="kpi-value" value="${data.p5_op + data.p5_reno}">${fmtCHF(data.p5_op + data.p5_reno)}</data><small class="kpi-sub">1% p.a.</small></figure>`;
    grid.innerHTML += `<figure class="kpi highlight" role="group"><figcaption class="kpi-label">Total Wohnkosten</figcaption><data class="kpi-value" value="${data.p5_total}">${fmtCHF(data.p5_total)}</data><small class="kpi-sub">pro Monat</small></figure>`;
    
    renderRecommendations();
  }

  function renderP6() {
    const b1Name = q('#b1_name')?.value?.trim() || 'Käufer 1';
    const b2Name = q('#b2_name')?.value?.trim() || '';
    const hasB2 = data.inc2 > 0 || b2Name !== '';
    
    const hypoGrid = q('#proposal_hypothek tbody') || q('#proposal_hypothek');
    if (hypoGrid) {
      hypoGrid.innerHTML = '';
      if (data.tranches && data.tranches.length > 0) {
        data.tranches.forEach((tranche, idx) => {
          hypoGrid.innerHTML += `<tr class="proposal-row neutral"><td class="proposal-product">${tranche.product}<small>Tranche ${idx + 1}</small></td><td class="proposal-amount">${fmtCHF(tranche.amount)}</td><td class="proposal-rate">~${tranche.rate.toFixed(2)}%</td><td class="proposal-choice"><fieldset><legend class="visually-hidden">Offerte einholen?</legend><label><input type="radio" name="hypo_${idx}" value="ja" checked> Ja</label><label><input type="radio" name="hypo_${idx}" value="nein"> Nein</label></fieldset></td></tr>`;
        });
      }
    }
    
    const insGrid = q('#proposal_insurance tbody') || q('#proposal_insurance');
    if (insGrid) {
      insGrid.innerHTML = '';
      if (riskGaps.b1.death > 0) {
        const isCritical = riskGaps.b1.death >= data.totalInvest * CONFIG.DEATH_CAPITAL_WARN_THRESHOLD;
        insGrid.innerHTML += `<tr class="proposal-row ${isCritical ? 'critical' : 'moderate'}"><td class="proposal-product">Todesfallrisiko<small>${b1Name}</small></td><td class="proposal-amount">${fmtCHF(riskGaps.b1.death)}</td><td class="proposal-rate">Versicherungssumme</td><td class="proposal-choice"><fieldset><legend class="visually-hidden">Offerte einholen?</legend><label><input type="radio" name="ins_death_b1" value="ja" ${isCritical ? 'checked' : ''}> Ja</label><label><input type="radio" name="ins_death_b1" value="nein" ${!isCritical ? 'checked' : ''}> Nein</label></fieldset></td></tr>`;
      }
      if (riskGaps.b1.iv > 0) {
        const isCritical = riskGaps.b1.iv >= data.effectiveIncome * CONFIG.INCOME_GAP_WARN_THRESHOLD;
        insGrid.innerHTML += `<tr class="proposal-row ${isCritical ? 'critical' : 'moderate'}"><td class="proposal-product">Erwerbsunfähigkeit<small>${b1Name}</small></td><td class="proposal-amount">${fmtCHF(riskGaps.b1.iv)}/Jahr</td><td class="proposal-rate">Rente</td><td class="proposal-choice"><fieldset><legend class="visually-hidden">Offerte einholen?</legend><label><input type="radio" name="ins_iv_b1" value="ja" ${isCritical ? 'checked' : ''}> Ja</label><label><input type="radio" name="ins_iv_b1" value="nein" ${!isCritical ? 'checked' : ''}> Nein</label></fieldset></td></tr>`;
      }
      if (hasB2 && riskGaps.b2.death > 0) {
        const isCritical = riskGaps.b2.death >= data.totalInvest * CONFIG.DEATH_CAPITAL_WARN_THRESHOLD;
        insGrid.innerHTML += `<tr class="proposal-row ${isCritical ? 'critical' : 'moderate'}"><td class="proposal-product">Todesfallrisiko<small>${b2Name || 'K2'}</small></td><td class="proposal-amount">${fmtCHF(riskGaps.b2.death)}</td><td class="proposal-rate">Versicherungssumme</td><td class="proposal-choice"><fieldset><legend class="visually-hidden">Offerte einholen?</legend><label><input type="radio" name="ins_death_b2" value="ja" ${isCritical ? 'checked' : ''}> Ja</label><label><input type="radio" name="ins_death_b2" value="nein" ${!isCritical ? 'checked' : ''}> Nein</label></fieldset></td></tr>`;
      }
      if (insGrid.innerHTML === '') {
        insGrid.innerHTML = `<tr class="proposal-row" style="background:var(--ok-bg); border-left-color:var(--ok);"><td colspan="4" class="proposal-product">✓ Keine Versicherungslücken</td></tr>`;
      }
    }
    
    const saveGrid = q('#proposal_saving tbody') || q('#proposal_saving');
    if (saveGrid) {
      saveGrid.innerHTML = '';
      const amortType = data.amortType || 'indirect';
      const amortDirect = data.amortDirect || 0;
      const amort3a = data.amort3a || (amortType === 'indirect' ? data.monthlyAmort : 0);
      const monthlyInterestReal = data.tranches?.length > 0 ? data.tranches.reduce((sum, t) => sum + t.mInt, 0) : (data.mortgage * currentMixRate) / 12;
      const monthlyOp = (data.totalInvest * CONFIG.RATE_OP) / 12;
      const monthlyLiegenschaft = Math.round(monthlyInterestReal + monthlyOp + amortDirect);
      
      saveGrid.innerHTML += `<tr class="proposal-row info"><td class="proposal-product">Liegenschaftskonto<small>Zins + Unterhalt</small></td><td class="proposal-amount">${fmtCHF(monthlyLiegenschaft)}/Mt</td><td class="proposal-rate">Dauerauftrag</td><td class="proposal-choice"><fieldset><legend class="visually-hidden">Einrichten?</legend><label><input type="radio" name="save_l" value="ja" checked> Ja</label><label><input type="radio" name="save_l" value="nein"> Nein</label></fieldset></td></tr>`;
      
      const monthlyReno = Math.round((data.totalInvest * CONFIG.RATE_RENO) / 12);
      saveGrid.innerHTML += `<tr class="proposal-row info"><td class="proposal-product">Renovation<small>Rückstellungen (0.6% p.a.)</small></td><td class="proposal-amount">${fmtCHF(monthlyReno)}/Mt</td><td class="proposal-rate">Sparkonto</td><td class="proposal-choice"><fieldset><legend class="visually-hidden">Einrichten?</legend><label><input type="radio" name="save_r" value="ja" checked> Ja</label><label><input type="radio" name="save_r" value="nein"> Nein</label></fieldset></td></tr>`;
      
      if (data.hypo2 > 0 && amort3a > 0) {
        saveGrid.innerHTML += `<tr class="proposal-row info"><td class="proposal-product">Säule 3a<small>Indirekte Amortisation</small></td><td class="proposal-amount">${fmtCHF(Math.round(amort3a))}/Mt</td><td class="proposal-rate">Vorsorge 3a</td><td class="proposal-choice"><fieldset><legend class="visually-hidden">Einrichten?</legend><label><input type="radio" name="save_3a" value="ja" checked> Ja</label><label><input type="radio" name="save_3a" value="nein"> Nein</label></fieldset></td></tr>`;
      }
      
      // Wertschriften-Sparplan für Pensionierung (wenn Lücke vorhanden)
      const maxPensionGap = Math.max(riskGaps.pension.b1, riskGaps.pension.b2, riskGaps.pension.both);
      if (maxPensionGap > 0) {
        const yearsUntilPension = Math.max(1, CONFIG.PENSION_AGE - data.age);
        const monthlyPensionSave = Math.round(maxPensionGap / yearsUntilPension / 12);
        saveGrid.innerHTML += `<tr class="proposal-row moderate"><td class="proposal-product">Wertschriften-Sparplan<small>Kapital für Pensionierung: ${fmtCHF(maxPensionGap)} in ${yearsUntilPension} J.</small></td><td class="proposal-amount">${fmtCHF(monthlyPensionSave)}/Mt</td><td class="proposal-rate">Anlage/ETF</td><td class="proposal-choice"><fieldset><legend class="visually-hidden">Beratung gewünscht?</legend><label><input type="radio" name="save_w" value="ja"> Ja</label><label><input type="radio" name="save_w" value="nein" checked> Nein</label></fieldset></td></tr>`;
      }
    }
    
    setText('#sig_name_b1', b1Name);
    setText('#sig_name_b2', b2Name || 'Käufer 2');
    const sigBlockB2 = q('#sig_block_b2');
    if (sigBlockB2) sigBlockB2.hidden = !hasB2;
    
    setupSachversicherungListeners();
  }
  
  function setupSachversicherungListeners() {
    const sachRadios = qAll('input[name^="sach_"]');
    const mandateSachText = q('#mandate_sach_text');
    const updateMandateText = () => {
      const anyChecked = Array.from(sachRadios).some(r => r.value === 'ja' && r.checked);
      if (mandateSachText) mandateSachText.hidden = !anyChecked;
    };
    sachRadios.forEach(radio => radio.addEventListener('change', updateMandateText));
    updateMandateText();
  }

  // --- TRANCHEN ---
  function getProductOptions() {
    const products = ['Fix 2 Jahre', 'Fix 3 Jahre', 'Fix 4 Jahre', 'Fix 5 Jahre', 'Fix 6 Jahre', 'Fix 7 Jahre', 'Fix 8 Jahre', 'Fix 10 Jahre', 'Fix 15 Jahre', 'SARON'];
    return products.map(p => `<option value="${p}">${p}</option>`).join('');
  }
  
  function addTrancheHTML(amount = 0, rate = 1.8) {
    const container = q('#trancheContainer');
    if (!container || container.children.length >= 4) return;
    const idx = container.children.length;
    const row = document.createElement('div');
    row.className = 'tranche-row';
    row.setAttribute('role', 'listitem');
    row.innerHTML = `<div class="tranche-select-group"><label class="visually-hidden" for="tranche-product-${idx}">Produkt</label><select id="tranche-product-${idx}">${getProductOptions()}</select></div><div class="tranche-input-group"><label class="visually-hidden" for="tranche-amount-${idx}">Betrag</label><input type="text" id="tranche-amount-${idx}" class="money tr-amount" value="${fmtCHF(amount)}" inputmode="numeric"><span class="tranche-warning" hidden>Min. CHF 100'000</span></div><div class="tranche-input-group"><label class="visually-hidden" for="tranche-rate-${idx}">Zinssatz</label><input type="number" id="tranche-rate-${idx}" step="0.01" class="tr-rate" value="${rate}" placeholder="%"></div><button type="button" class="btn-del-tranche" aria-label="Tranche entfernen">×</button>`;
    const amountInput = row.querySelector('.tr-amount');
    const rateInput = row.querySelector('.tr-rate');
    const deleteBtn = row.querySelector('.btn-del-tranche');
    amountInput.addEventListener('change', e => { e.target.value = fmtCHF(parseCHF(e.target.value)); updateTrancheZero(); reCalcP4(); });
    rateInput.addEventListener('input', reCalcP4);
    deleteBtn.addEventListener('click', () => { row.remove(); updateTrancheZero(); reCalcP4(); });
    container.appendChild(row);
  }
  
  function updateTrancheZero() {
    const container = q('#trancheContainer');
    if (!container || container.children.length < 2) return;
    let sum = 0;
    const rows = container.children;
    for (let i = 1; i < rows.length; i++) {
      const amountEl = rows[i].querySelector('.tr-amount');
      if (amountEl) sum += parseCHF(amountEl.value);
    }
    const firstAmount = rows[0].querySelector('.tr-amount');
    if (firstAmount) firstAmount.value = fmtCHF(Math.max(0, data.mortgage - sum));
  }
  
  function initTranches() {
    const container = q('#trancheContainer');
    if (container) container.innerHTML = '';
    addTrancheHTML(data.mortgage, 1.8);
    setupAmortizationListeners();
    reCalcP4();
  }

  // --- NAVIGATION ---
  function showSection(sectionId) {
    const section = q(sectionId);
    if (section) { section.classList.remove('collapsed'); section.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }
  function hideSection(sectionId) {
    const section = q(sectionId);
    if (section) section.classList.add('collapsed');
  }
  function setActiveStep(stepNum) {
    qAll('.step').forEach(s => { s.classList.remove('active'); s.removeAttribute('aria-current'); });
    const step = q(`#step${stepNum}-ind`);
    if (step) { step.classList.add('active'); step.setAttribute('aria-current', 'step'); }
  }

  // --- EVENT LISTENERS ---
  function initEventListeners() {
    qAll('.money').forEach(el => {
      el.addEventListener('change', e => { e.target.value = fmtNumber(parseCHF(e.target.value)); calcAll(); });
    });
    
    const btnCalcP1 = q('#btnCalcPhase1');
    if (btnCalcP1) {
      btnCalcP1.addEventListener('click', () => {
        calcAll();
        const errors = validateInputs();
        const banner = q('#validationBanner');
        if (errors.length > 0) {
          if (banner) { banner.hidden = false; banner.innerHTML = errors.join('<br>'); }
        } else {
          if (banner) banner.hidden = true;
          hideSection('#sectionInputs');
          showSection('#sectionResultsP1');
          renderP1();
          setActiveStep(1);
        }
      });
    }
    
    const btnEditP1 = q('#btnEditP1');
    if (btnEditP1) {
      btnEditP1.addEventListener('click', () => {
        ['#sectionResultsP1', '#sectionResultsP2', '#sectionResultsRisk', '#sectionResultsP4', '#sectionResultsP5', '#sectionResultsP6'].forEach(s => hideSection(s));
        const inputSection = q('#sectionInputs');
        if (inputSection) inputSection.classList.remove('collapsed');
        setActiveStep(1);
      });
    }
    
    q('#btnToPhase2')?.addEventListener('click', () => { showSection('#sectionResultsP2'); renderP2(); setActiveStep(2); });
    q('#btnToPhase3')?.addEventListener('click', () => { showSection('#sectionResultsRisk'); renderRisk(); setActiveStep(3); });
    q('#btnToPhase4')?.addEventListener('click', () => { showSection('#sectionResultsP4'); initTranches(); setActiveStep(4); });
    q('#btnToPhase5')?.addEventListener('click', () => { reCalcP4(); showSection('#sectionResultsP5'); renderP5(); setActiveStep(5); });
    q('#btnToPhase6')?.addEventListener('click', () => { showSection('#sectionResultsP6'); renderP6(); setActiveStep(6); });
    
    q('#btnBackToP2')?.addEventListener('click', () => { hideSection('#sectionResultsRisk'); setActiveStep(2); q('#sectionResultsP2')?.scrollIntoView({ behavior: 'smooth' }); });
    q('#btnBackToRisk')?.addEventListener('click', () => { hideSection('#sectionResultsP4'); setActiveStep(3); q('#sectionResultsRisk')?.scrollIntoView({ behavior: 'smooth' }); });
    q('#btnBackToP4')?.addEventListener('click', () => { hideSection('#sectionResultsP5'); setActiveStep(4); q('#sectionResultsP4')?.scrollIntoView({ behavior: 'smooth' }); });
    q('#btnBackToP5')?.addEventListener('click', () => { hideSection('#sectionResultsP6'); setActiveStep(5); q('#sectionResultsP5')?.scrollIntoView({ behavior: 'smooth' }); });
    
    q('#btnPrint')?.addEventListener('click', () => window.print());
    q('#btnPDF')?.addEventListener('click', () => {
      const element = document.querySelector('main');
      if (!element) return;
      const opt = {
        margin: [10, 10, 10, 10],
        filename: 'Hypotheken-Analyse.pdf',
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { orientation: 'portrait', unit: 'mm', format: 'a4' }
      };
      html2pdf().set(opt).from(element).save();
    });
    
    q('#btnAddTranche')?.addEventListener('click', () => { addTrancheHTML(0, 1.8); reCalcP4(); });
  }

  // --- INIT ---
  function init() {
    const defaultBirthdate = new Date();
    defaultBirthdate.setFullYear(defaultBirthdate.getFullYear() - 35);
    const dateStr = defaultBirthdate.toISOString().split('T')[0];
    const b1Birth = q('#b1_birth');
    const b2Birth = q('#b2_birth');
    if (b1Birth && !b1Birth.value) b1Birth.value = dateStr;
    if (b2Birth && !b2Birth.value) b2Birth.value = dateStr;
    
    initEventListeners();
    calcAll();
    console.log('Hypothekar-Cockpit (Semantic) initialisiert');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
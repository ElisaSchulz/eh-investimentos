Attribute VB_Name = "EspelhosProposta"
'==============================================================================
' Proposta Base de Dados EH: historico e abas espelho
'
' ImportarHistorico
'   Acrescenta nas tabelas da Proposta (tbl_Cotacoes, tbl_Indices, tbl_Eventos,
'   tbl_Cadastro) as linhas de um arquivo gerado na migracao (abas Cotacoes,
'   Indices, Eventos, Cadastro) e copia a aba Layout_Espelhos. Antes, tira das
'   tres primeiras as linhas que vieram de uma migracao anterior (Fonte "Base
'   atual (migracao)" ou "Planilha atual (migracao)"), entao pode rodar de novo
'   com um arquivo corrigido. Pula o que ja existe (mesma data + codigo, ...).
'   Nao salva.
'
' MontarEspelhos
'   (Re)monta na Proposta as abas no formato da base antiga, so com valores
'   tirados das tabelas: Cotas, Cotas USD, Fluxos, Dados, Tabela produtos e
'   Resumo de Mercado. As planilhas dos clientes leem essas abas pelo vinculo
'   (Dados > Editar Links > Alterar Fonte para a Proposta). Rode de novo depois
'   de cada atualizacao de dados. Nao salva.
'
' As duas rodam na pasta de trabalho ATIVA (a Proposta, .xlsx no OneDrive);
' o codigo fica na planilha de macros local.
'==============================================================================
Option Explicit

Private Const LAYOUT As String = "Layout_Espelhos"
Private mCS As Long     ' coluna Subclasse de tbl_Cotacoes (series da aba Dados usam Subclasse "Dados")

' ---- nomes com acento (o modulo e ASCII de proposito) ----
Private Function sCodigo() As String: sCodigo = "C" & ChrW(243) & "digo": End Function
Private Function sMes() As String: sMes = "M" & ChrW(234) & "s": End Function
Private Function sIndice() As String: sIndice = ChrW(205) & "ndice": End Function
Private Function sAmort() As String: sAmort = "Amortiza" & ChrW(231) & ChrW(227) & "o": End Function

'==============================================================================
Public Sub ImportarHistorico()
    Dim base As Workbook, arq As Variant, wbO As Workbook, rel As String, calcAntes As XlCalculation
    Set base = ActiveWorkbook
    If Not TemTabela(base, "tbl_Cotacoes") Then
        MsgBox "Deixe a Proposta ativa antes de rodar (ela precisa ter a tabela tbl_Cotacoes).", vbExclamation
        Exit Sub
    End If
    arq = Application.GetOpenFilename("Historico (*.xlsx),*.xlsx", , "Escolha o historico_base_atual_para_proposta.xlsx")
    If VarType(arq) = vbBoolean Then Exit Sub

    calcAntes = Application.Calculation
    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual
    Application.StatusBar = "Abrindo o historico..."
    On Error GoTo Falha
    Set wbO = Workbooks.Open(CStr(arq), ReadOnly:=True, UpdateLinks:=0)

    rel = rel & RemoverMigracao(base, "tbl_Cotacoes")
    rel = rel & RemoverMigracao(base, "tbl_Indices")
    rel = rel & RemoverMigracao(base, "tbl_Eventos")
    rel = rel & Acrescentar(base, wbO, "Cotacoes", "tbl_Cotacoes", Array("Data", sCodigo(), "Subclasse"))
    rel = rel & Acrescentar(base, wbO, "Indices", "tbl_Indices", Array(sMes(), sIndice()))
    rel = rel & Acrescentar(base, wbO, "Eventos", "tbl_Eventos", Array(sCodigo(), "Data pagamento", "Tipo"))
    rel = rel & Acrescentar(base, wbO, "Cadastro", "tbl_Cadastro", Array(sCodigo()))

    ' Layout dos espelhos: substitui a aba inteira
    If TemAba(wbO, LAYOUT) Then
        Application.DisplayAlerts = False
        If TemAba(base, LAYOUT) Then base.Worksheets(LAYOUT).Delete
        Application.DisplayAlerts = True
        wbO.Worksheets(LAYOUT).Copy After:=base.Worksheets(base.Worksheets.Count)
        base.Worksheets(LAYOUT).Visible = xlSheetHidden
        rel = rel & "- Layout_Espelhos copiada (aba oculta)" & vbCrLf
    End If
    wbO.Close SaveChanges:=False
    base.Activate

    Application.StatusBar = False
    Application.Calculation = calcAntes
    Application.ScreenUpdating = True
    MsgBox rel & vbCrLf & "Agora rode MontarEspelhos." & vbCrLf & "A Proposta nao foi salva: confira e salve.", _
           vbInformation, "Importar historico"
    Exit Sub
Falha:
    Application.DisplayAlerts = True
    Application.StatusBar = False
    Application.Calculation = calcAntes
    Application.ScreenUpdating = True
    MsgBox "Erro ao importar: " & Err.Description, vbCritical, "Importar historico"
End Sub

' Acrescenta as linhas da aba 'aba' do arquivo na tabela 'tbl', casando as colunas pelo nome
Private Function Acrescentar(base As Workbook, wbO As Workbook, aba As String, tbl As String, chaves As Variant) As String
    Dim wsO As Worksheet, lo As ListObject, src As Variant, n As Long, nc As Long, i As Long, j As Long, k As Long
    Dim mapa() As Long, existe As Object, chave As String, novas() As Variant, nNovas As Long, nRep As Long
    Dim idxChaveO() As Long, idxChaveT() As Long, tcols As Long, atual As Variant, usadas As Long
    If Not TemAba(wbO, aba) Then Exit Function
    Set lo = AcharTabela(base, tbl)
    If lo Is Nothing Then Acrescentar = "- " & tbl & ": tabela nao encontrada (pulei)" & vbCrLf: Exit Function
    Set wsO = wbO.Worksheets(aba)
    src = wsO.UsedRange.Value
    n = UBound(src, 1) - 1: nc = UBound(src, 2)
    If n < 1 Then Exit Function
    Application.StatusBar = "Importando " & aba & " (" & Format(n, "#,##0") & " linhas)..."
    tcols = lo.ListColumns.Count
    ReDim mapa(1 To nc)
    For j = 1 To nc: mapa(j) = ColunaDaTabela(lo, CStr(src(1, j))): Next j
    ReDim idxChaveO(LBound(chaves) To UBound(chaves)): ReDim idxChaveT(LBound(chaves) To UBound(chaves))
    For k = LBound(chaves) To UBound(chaves)
        idxChaveT(k) = ColunaDaTabela(lo, CStr(chaves(k)))
        idxChaveO(k) = 0
        For j = 1 To nc
            If CStr(src(1, j)) = CStr(chaves(k)) Then idxChaveO(k) = j
        Next j
    Next k

    ' chaves que ja estao na tabela
    Set existe = CreateObject("Scripting.Dictionary")
    usadas = LinhasUsadas(lo)
    If usadas > 0 Then
        atual = lo.DataBodyRange.Value
        For i = 1 To usadas
            chave = ""
            For k = LBound(chaves) To UBound(chaves)
                If idxChaveT(k) > 0 Then chave = chave & "|" & Chave1(atual(i, idxChaveT(k)))
            Next k
            existe(chave) = True
        Next i
    End If

    ReDim novas(1 To n, 1 To tcols)
    For i = 2 To n + 1
        chave = ""
        For k = LBound(chaves) To UBound(chaves)
            If idxChaveO(k) > 0 Then chave = chave & "|" & Chave1(src(i, idxChaveO(k)))
        Next k
        If existe.Exists(chave) Then
            nRep = nRep + 1
        Else
            existe(chave) = True
            nNovas = nNovas + 1
            For j = 1 To nc
                If mapa(j) > 0 Then novas(nNovas, mapa(j)) = src(i, j)
            Next j
        End If
    Next i
    If nNovas > 0 Then EscreverNoFim lo, novas, nNovas, tcols
    Acrescentar = "- " & aba & ": " & Format(nNovas, "#,##0") & " novas, " & Format(nRep, "#,##0") & " ja existiam" & vbCrLf
End Function

' Tira da tabela as linhas cuja Fonte e de migracao da base atual (para reimportar corrigido)
Private Function RemoverMigracao(base As Workbook, tbl As String) As String
    Dim lo As ListObject, cF As Long, usadas As Long, dados As Variant, i As Long, j As Long, nK As Long, f As String
    Dim fica() As Variant, tcols As Long, sMig As String
    Set lo = AcharTabela(base, tbl)
    If lo Is Nothing Then Exit Function
    cF = ColunaDaTabela(lo, "Fonte")
    usadas = LinhasUsadas(lo)
    If cF = 0 Or usadas = 0 Then Exit Function
    Application.StatusBar = "Limpando " & tbl & "..."
    sMig = "atual (migra" & ChrW(231) & ChrW(227) & "o)"
    tcols = lo.ListColumns.Count
    dados = lo.DataBodyRange.Value
    ReDim fica(1 To usadas, 1 To tcols)
    For i = 1 To usadas
        f = CStr(dados(i, cF))
        If Not (f = "Base " & sMig Or f = "Planilha " & sMig) Then
            nK = nK + 1
            For j = 1 To tcols: fica(nK, j) = dados(i, j): Next j
        End If
    Next i
    If nK = usadas Then Exit Function
    lo.DataBodyRange.ClearContents
    If nK > 0 Then
        lo.DataBodyRange.Cells(1, 1).Resize(nK, tcols).Value = fica
        lo.Resize lo.Range.Resize(1 + nK)
    Else
        lo.Resize lo.Range.Resize(2)
    End If
    RemoverMigracao = "- " & tbl & ": " & Format(usadas - nK, "#,##0") & " linhas da migracao anterior removidas" & vbCrLf
End Function

Private Function Chave1(v As Variant) As String
    If IsDate(v) And VarType(v) = vbDate Then
        Chave1 = CStr(CLng(v))
    ElseIf IsEmpty(v) Then
        Chave1 = ""
    Else
        Chave1 = UCase(Trim(CStr(v)))
    End If
End Function

Private Sub EscreverNoFim(lo As ListObject, novas As Variant, nNovas As Long, tcols As Long)
    Dim usadas As Long, primeira As Long
    usadas = LinhasUsadas(lo)
    primeira = lo.HeaderRowRange.Row + 1 + usadas
    lo.Resize lo.Range.Resize(1 + usadas + nNovas)
    ' a matriz pode ter mais linhas que nNovas: o Excel grava so o pedaco do tamanho do intervalo
    lo.Parent.Cells(primeira, lo.Range.Column).Resize(nNovas, tcols).Value = novas
End Sub

'==============================================================================
Public Sub MontarEspelhos()
    Dim base As Workbook, calcAntes As XlCalculation, rel As String, t As Single
    Set base = ActiveWorkbook
    If Not TemAba(base, LAYOUT) Or Not TemTabela(base, "tbl_Cotacoes") Then
        MsgBox "Deixe a Proposta ativa (ela precisa ter tbl_Cotacoes e a aba " & LAYOUT & _
               ", que vem com ImportarHistorico).", vbExclamation
        Exit Sub
    End If
    t = Timer
    calcAntes = Application.Calculation
    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual
    On Error GoTo Falha

    Dim cot As Variant, cD As Long, cC As Long, cV As Long, nCot As Long
    Dim lo As ListObject
    Set lo = AcharTabela(base, "tbl_Cotacoes")
    cot = lo.DataBodyRange.Value: nCot = LinhasUsadas(lo)
    cD = ColunaDaTabela(lo, "Data"): cC = ColunaDaTabela(lo, sCodigo()): cV = ColunaDaTabela(lo, "Valor")
    mCS = ColunaDaTabela(lo, "Subclasse")

    Application.StatusBar = "Montando Cotas..."
    rel = rel & MontarGrade(base, "Cotas", 2, 3, 4, 2, cot, nCot, cD, cC, cV)
    Application.StatusBar = "Montando Cotas USD..."
    rel = rel & MontarGrade(base, "Cotas USD", 1, 4, 5, 1, cot, nCot, cD, cC, cV)
    Application.StatusBar = "Montando Fluxos..."
    rel = rel & MontarFluxos(base)
    Application.StatusBar = "Montando Dados..."
    rel = rel & MontarDados(base, cot, nCot, cD, cC, cV)
    Application.StatusBar = "Montando Tabela produtos e Resumo de Mercado..."
    PrepararAba base, "Tabela produtos": EscreverLayout base, "Tabela produtos"
    PrepararAba base, "Resumo de Mercado": EscreverLayout base, "Resumo de Mercado"
    rel = rel & "- Tabela produtos e Resumo de Mercado: copiados do layout" & vbCrLf

    Application.StatusBar = "Calculando..."
    Application.Calculation = calcAntes
    Application.Calculate     ' mesmo em modo manual, para salvar com os valores das formulas
    Application.StatusBar = False
    Application.ScreenUpdating = True
    MsgBox "Espelhos montados em " & Format(Timer - t, "0") & " s:" & vbCrLf & rel & vbCrLf & _
           "A Proposta nao foi salva: confira e salve.", vbInformation, "Montar espelhos"
    Exit Sub
Falha:
    Application.StatusBar = False
    Application.Calculation = calcAntes
    Application.ScreenUpdating = True
    MsgBox "Erro ao montar os espelhos: " & Err.Description, vbCritical, "Montar espelhos"
End Sub

' Grade de cotas: codigos na linha linCod (a partir da coluna colData+1), indice na linha linIdx,
' datas na coluna colData a partir da linha lin0. Sem cota no dia = repete a anterior.
Private Function MontarGrade(base As Workbook, aba As String, linCod As Long, linIdx As Long, lin0 As Long, colData As Long, _
                             cot As Variant, nCot As Long, cD As Long, cC As Long, cV As Long) As String
    Dim ws As Worksheet, ultCol As Long, j As Long, cols As Object, datas As Object, i As Long, code As String
    Dim lista() As Double, nd As Long, k As Variant, grade() As Variant, r As Long, c As Long, ultimo As Variant
    PrepararAba base, aba
    EscreverLayout base, aba
    Set ws = base.Worksheets(aba)
    ultCol = ws.Cells(linCod, ws.Columns.Count).End(xlToLeft).Column
    Set cols = CreateObject("Scripting.Dictionary")
    For j = colData + 1 To ultCol
        code = UCase(Trim(CStr(ws.Cells(linCod, j).Value)))
        If code <> "" And Not cols.Exists(code) Then cols(code) = j
    Next j
    ' datas com alguma cota destes codigos
    Set datas = CreateObject("Scripting.Dictionary")
    For i = 1 To nCot
        If cols.Exists(UCase(Trim(CStr(cot(i, cC))))) And Not EhDados(cot, i) Then
            If IsDate(cot(i, cD)) Then datas(CDbl(CDate(cot(i, cD)))) = True
        End If
    Next i
    nd = datas.Count
    If nd = 0 Then MontarGrade = "- " & aba & ": sem cotas" & vbCrLf: Exit Function
    ReDim lista(1 To nd): i = 0
    For Each k In datas.Keys: i = i + 1: lista(i) = k: Next k
    Ordenar lista, 1, nd
    Set datas = CreateObject("Scripting.Dictionary")
    For i = 1 To nd: datas(lista(i)) = i: Next i
    ReDim grade(1 To nd, 1 To ultCol - colData + 1)
    For i = 1 To nd: grade(i, 1) = CDate(lista(i)): Next i
    For i = 1 To nCot
        code = UCase(Trim(CStr(cot(i, cC))))
        If cols.Exists(code) And IsDate(cot(i, cD)) And Not EhDados(cot, i) Then
            r = datas(CDbl(CDate(cot(i, cD))))
            grade(r, cols(code) - colData + 1) = cot(i, cV)
        End If
    Next i
    ' repete a ultima cota nos dias sem cota (como as formulas =celula de cima da base antiga)
    For c = 2 To ultCol - colData + 1
        ultimo = Empty
        For r = 1 To nd
            If IsEmpty(grade(r, c)) Then
                If Not IsEmpty(ultimo) Then grade(r, c) = ultimo
            Else
                ultimo = grade(r, c)
            End If
        Next r
    Next c
    ' indice das colunas (o HLOOKUP das planilhas usa esta linha)
    For j = colData To ultCol: ws.Cells(linIdx, j).Value = j - colData + 1: Next j
    ws.Cells(lin0, colData).Resize(nd, ultCol - colData + 1).Value = grade
    ws.Columns(colData).NumberFormat = "dd/mm/yyyy"
    ws.Cells(linIdx, colData).NumberFormat = "General"
    MontarGrade = "- " & aba & ": " & cols.Count & " ativos x " & Format(nd, "#,##0") & " datas" & vbCrLf
End Function

' Fluxos: rotulos, colunas A:G e datas da linha 1 (a partir de H) vem do layout, como na base antiga
' (C = codigo na linha de Amortizacao, a de baixo e Juros). Valores = soma de tbl_Eventos por codigo,
' tipo e data; data de evento que nao esta na linha 1 entra no fim.
Private Function MontarFluxos(base As Workbook) As String
    Const COL0 As Long = 8
    Dim ws As Worksheet, lo As ListObject, evs As Variant, nEv As Long, eC As Long, eD As Long, eT As Long, eVal As Long
    Dim linhas As Object, ult As Long, i As Long, code As String, colDe As Object, ultC As Long, nCols As Long
    Dim grade As Variant, r As Long, c As Long, tipo As String, dt As Double, nNovas As Long, nVal As Long
    PrepararAba base, "Fluxos"
    EscreverLayout base, "Fluxos"
    Set ws = base.Worksheets("Fluxos")
    Set lo = AcharTabela(base, "tbl_Eventos")
    evs = lo.DataBodyRange.Value: nEv = LinhasUsadas(lo)
    eC = ColunaDaTabela(lo, sCodigo()): eD = ColunaDaTabela(lo, "Data pagamento")
    eT = ColunaDaTabela(lo, "Tipo"): eVal = ColunaDaTabela(lo, "Valor por unidade")
    ult = Application.WorksheetFunction.Max(ws.Cells(ws.Rows.Count, 3).End(xlUp).Row, ws.Cells(ws.Rows.Count, 4).End(xlUp).Row)
    Set linhas = CreateObject("Scripting.Dictionary")
    For i = 2 To ult
        If CStr(ws.Cells(i, 5).Value) = sAmort() Then
            code = UCase(Trim(CStr(ws.Cells(i, 3).Value)))
            If code <> "" And Not linhas.Exists(code) Then linhas(code) = i
        End If
    Next i
    ' colunas das datas que ja estao na linha 1
    ultC = ws.Cells(1, ws.Columns.Count).End(xlToLeft).Column
    If ultC < COL0 Then ultC = COL0 - 1
    Set colDe = CreateObject("Scripting.Dictionary")
    For c = COL0 To ultC
        If VarType(ws.Cells(1, c).Value) = vbDate Then colDe(CDbl(ws.Cells(1, c).Value)) = c
    Next c
    ' datas de eventos que faltam: vao para o fim
    For i = 1 To nEv
        If linhas.Exists(UCase(Trim(CStr(evs(i, eC))))) And IsDate(evs(i, eD)) Then
            dt = CDbl(CDate(evs(i, eD)))
            If Not colDe.Exists(dt) Then
                nNovas = nNovas + 1
                colDe(dt) = ultC + nNovas
                ws.Cells(1, ultC + nNovas).Value = CDate(dt)
            End If
        End If
    Next i
    nCols = ultC + nNovas - COL0 + 1
    If nCols < 1 Then MontarFluxos = "- Fluxos: sem datas" & vbCrLf: Exit Function
    grade = ws.Cells(1, COL0).Resize(ult, nCols).Value
    For i = 1 To nEv
        code = UCase(Trim(CStr(evs(i, eC))))
        If linhas.Exists(code) And IsDate(evs(i, eD)) And IsNumeric(evs(i, eVal)) Then
            If Not IsEmpty(evs(i, eVal)) Then
                tipo = CStr(evs(i, eT))
                r = linhas(code)
                If tipo <> sAmort() Then r = r + 1            ' Juros e Dividendo/Rendimento: linha de baixo
                c = colDe(CDbl(CDate(evs(i, eD)))) - COL0 + 1
                If r <= ult And VarType(grade(r, c)) <> vbString Then
                    grade(r, c) = Val0(grade(r, c)) + CDbl(evs(i, eVal)): nVal = nVal + 1
                End If
            End If
        End If
    Next i
    ws.Cells(1, COL0).Resize(ult, nCols).Value = grade
    ws.Cells(1, COL0).Resize(1, nCols).NumberFormat = "dd/mm/yyyy"
    MontarFluxos = "- Fluxos: " & linhas.Count & " ativos x " & nCols & " datas (" & nNovas & " novas), " & Format(nVal, "#,##0") & " valores" & vbCrLf
End Function

' Dados: mesmas colunas da base antiga
Private Function MontarDados(base As Workbook, cot As Variant, nCot As Long, cD As Long, cC As Long, cV As Long) As String
    Dim ws As Worksheet, lo As ListObject, v As Variant, n As Long, i As Long, rel As String
    PrepararAba base, "Dados"
    EscreverLayout base, "Dados"
    Set ws = base.Worksheets("Dados")

    ' A:C feriados
    Set lo = AcharTabela(base, "tbl_Feriados")
    v = lo.DataBodyRange.Value: n = LinhasUsadas(lo)
    Dim fer() As Variant: ReDim fer(1 To n, 1 To 3)
    For i = 1 To n
        fer(i, 1) = v(i, 1)
        If IsDate(v(i, 1)) Then fer(i, 2) = Format(CDate(v(i, 1)), "dddd")
        fer(i, 3) = v(i, 2)
    Next i
    ws.Range("A2").Resize(n, 3).Value = fer
    ws.Columns("A").NumberFormat = "dd/mm/yyyy"

    ' E:K mensais (IPCA, IGPM, POUPANCA) e AN:AO CPI
    Set lo = AcharTabela(base, "tbl_Indices")
    v = lo.DataBodyRange.Value: n = LinhasUsadas(lo)
    Dim iM As Long, iI As Long, iV As Long
    iM = ColunaDaTabela(lo, sMes()): iI = ColunaDaTabela(lo, sIndice()): iV = ColunaDaTabela(lo, "Valor")
    Dim meses As Object, cpi As Object, lst() As Double, k As Variant, nm As Long, r As Long
    Set meses = CreateObject("Scripting.Dictionary"): Set cpi = CreateObject("Scripting.Dictionary")
    For i = 1 To n
        If IsDate(v(i, iM)) Then
            Select Case UCase(CStr(v(i, iI)))
                Case "IPCA", "IGPM", "POUPANCA": meses(CDbl(CDate(v(i, iM)))) = True
                Case "CPI": cpi(CDbl(CDate(v(i, iM)))) = v(i, iV)
            End Select
        End If
    Next i
    nm = meses.Count
    If nm > 0 Then
        ReDim lst(1 To nm): i = 0
        For Each k In meses.Keys: i = i + 1: lst(i) = k: Next k
        Ordenar lst, 1, nm
        Set meses = CreateObject("Scripting.Dictionary")
        For i = 1 To nm: meses(lst(i)) = i: Next i
        Dim men() As Variant: ReDim men(1 To nm, 1 To 7)
        For i = 1 To nm: men(i, 1) = CDate(lst(i)): Next i
        For i = 1 To n
            If IsDate(v(i, iM)) Then
                If meses.Exists(CDbl(CDate(v(i, iM)))) Then
                    r = meses(CDbl(CDate(v(i, iM))))
                    Select Case UCase(CStr(v(i, iI)))
                        Case "IPCA": men(r, 2) = v(i, iV)
                        Case "IGPM": men(r, 4) = v(i, iV)
                        Case "POUPANCA": men(r, 6) = v(i, iV)
                    End Select
                End If
            End If
        Next i
        ws.Range("E3").Resize(nm, 7).Value = men
        ws.Range("G3").Resize(nm, 1).FormulaR1C1 = "=R[-1]C*(1+RC[-1])"
        ws.Range("I3").Resize(nm, 1).FormulaR1C1 = "=R[-1]C*(1+RC[-1])"
        ws.Range("K3").Resize(nm, 1).FormulaR1C1 = "=R[-1]C*(1+RC[-1])"
        ws.Columns("E").NumberFormat = "dd/mm/yyyy"
        rel = rel & "- Dados E:K: " & nm & " meses" & vbCrLf
    End If
    If cpi.Count > 0 Then
        ReDim lst(1 To cpi.Count): i = 0
        For Each k In cpi.Keys: i = i + 1: lst(i) = k: Next k
        Ordenar lst, 1, cpi.Count
        Dim cp() As Variant: ReDim cp(1 To cpi.Count, 1 To 2)
        For i = 1 To cpi.Count: cp(i, 1) = CDate(lst(i)): cp(i, 2) = cpi(lst(i)): Next i
        ws.Range("AN3").Resize(cpi.Count, 2).Value = cp
        ws.Columns("AN").NumberFormat = "dd/mm/yyyy"
    End If

    ' M:O CDI (O = indice acumulado) e projecao ate a linha 15000 como na base antiga
    Dim nCdi As Long
    nCdi = SerieDiaria(ws, "M", Array("CDI"), cot, nCot, cD, cC, cV)
    If nCdi > 0 Then
        ws.Range("O3").Value = 1
        If nCdi > 1 Then ws.Range("O4").Resize(nCdi - 1, 1).FormulaR1C1 = "=R[-1]C*(1+R[-1]C[-1])^(1/252)"
        If 3 + nCdi <= 15000 Then
            With ws.Range(ws.Cells(3 + nCdi, 13), ws.Cells(15000, 13))
                .FormulaR1C1 = "=WORKDAY(R[-1]C,1,R2C1:R797C1)"
            End With
            ws.Range(ws.Cells(3 + nCdi, 14), ws.Cells(15000, 14)).FormulaR1C1 = "=R[-1]C"
            ws.Range(ws.Cells(3 + nCdi, 15), ws.Cells(15000, 15)).FormulaR1C1 = "=R[-1]C*(1+R[-1]C[-1])^(1/252)"
        End If
        ws.Columns("M").NumberFormat = "dd/mm/yyyy"
    End If
    rel = rel & "- Dados CDI: " & nCdi & " dias" & vbCrLf
    rel = rel & "- Dados PTAX: " & SerieDiaria(ws, "Q", Array("PTAX"), cot, nCot, cD, cC, cV) & " dias" & vbCrLf
    rel = rel & "- Dados IBOV: " & SerieDiaria(ws, "T", Array("IBOV"), cot, nCot, cD, cC, cV) & " dias" & vbCrLf
    rel = rel & "- Dados S&P 500: " & SerieDiaria(ws, "W", Array("SP500"), cot, nCot, cD, cC, cV) & " dias" & vbCrLf
    ' Z:AL indicadores globais (codigos na linha 2, de AA a AL)
    Dim glob(1 To 12) As Variant, j As Long
    For j = 1 To 12: glob(j) = CStr(ws.Cells(2, 26 + j).Value): Next j
    rel = rel & "- Dados globais: " & SerieDiaria(ws, "Z", glob, cot, nCot, cD, cC, cV) & " dias" & vbCrLf
    MontarDados = rel
End Function

' Escreve data + uma coluna por codigo a partir da linha 3 da coluna colLetra. Devolve o numero de datas.
Private Function SerieDiaria(ws As Worksheet, colLetra As String, codigos As Variant, cot As Variant, nCot As Long, _
                             cD As Long, cC As Long, cV As Long) As Long
    Dim cods As Object, k As Long, datas As Object, i As Long, lst() As Double, kk As Variant, nd As Long, g() As Variant, code As String
    Set cods = CreateObject("Scripting.Dictionary")
    For k = LBound(codigos) To UBound(codigos)
        If CStr(codigos(k)) <> "" Then cods(UCase(CStr(codigos(k)))) = k - LBound(codigos) + 2
    Next k
    ' codigo com linhas de Subclasse "Dados" usa so essas (ex.: AGG tambem existe na Cotas USD)
    Dim temDados As Object: Set temDados = CreateObject("Scripting.Dictionary")
    For i = 1 To nCot
        If EhDados(cot, i) Then temDados(UCase(Trim(CStr(cot(i, cC))))) = True
    Next i
    Set datas = CreateObject("Scripting.Dictionary")
    For i = 1 To nCot
        code = UCase(Trim(CStr(cot(i, cC))))
        If cods.Exists(code) And IsDate(cot(i, cD)) Then
            If EhDados(cot, i) Or Not temDados.Exists(code) Then datas(CDbl(CDate(cot(i, cD)))) = True
        End If
    Next i
    nd = datas.Count
    If nd = 0 Then Exit Function
    ReDim lst(1 To nd): i = 0
    For Each kk In datas.Keys: i = i + 1: lst(i) = kk: Next kk
    Ordenar lst, 1, nd
    Set datas = CreateObject("Scripting.Dictionary")
    For i = 1 To nd: datas(lst(i)) = i: Next i
    ReDim g(1 To nd, 1 To UBound(codigos) - LBound(codigos) + 2)
    For i = 1 To nd: g(i, 1) = CDate(lst(i)): Next i
    For i = 1 To nCot
        code = UCase(Trim(CStr(cot(i, cC))))
        If cods.Exists(code) And IsDate(cot(i, cD)) Then
            If EhDados(cot, i) Or Not temDados.Exists(code) Then g(datas(CDbl(CDate(cot(i, cD)))), cods(code)) = cot(i, cV)
        End If
    Next i
    ws.Range(colLetra & "3").Resize(nd, UBound(g, 2)).Value = g
    ws.Columns(colLetra).NumberFormat = "dd/mm/yyyy"
    SerieDiaria = nd
End Function

'------------------------------------------------------------------------------
' Cria a aba (ou limpa, se ja existe: apagar quebraria os vinculos das planilhas abertas)
Private Sub PrepararAba(base As Workbook, aba As String)
    If TemAba(base, aba) Then
        base.Worksheets(aba).Cells.Clear
    Else
        base.Worksheets.Add(After:=base.Worksheets(base.Worksheets.Count)).Name = aba
    End If
End Sub

' Copia da aba Layout_Espelhos os valores e formulas fixos desta aba
Private Sub EscreverLayout(base As Workbook, aba As String)
    Dim ws As Worksheet, lay As Variant, i As Long, n As Long, txt As String
    Set ws = base.Worksheets(aba)
    lay = base.Worksheets(LAYOUT).UsedRange.Value
    n = UBound(lay, 1)
    For i = 2 To n
        If CStr(lay(i, 1)) = aba Then
            If VarType(lay(i, 4)) = vbString Then
                txt = lay(i, 4)
                If Left(txt, 1) = "=" Then
                    ws.Cells(lay(i, 2), lay(i, 3)).Formula = txt
                Else
                    ws.Cells(lay(i, 2), lay(i, 3)).Value = "'" & txt
                End If
            Else
                ws.Cells(lay(i, 2), lay(i, 3)).Value = lay(i, 4)
            End If
        End If
    Next i
End Sub

Private Function EhDados(cot As Variant, i As Long) As Boolean
    If mCS > 0 Then EhDados = (UCase(Trim(CStr(cot(i, mCS)))) = "DADOS")
End Function

Private Function Val0(v As Variant) As Double
    If IsNumeric(v) And Not IsEmpty(v) Then Val0 = CDbl(v)
End Function

Private Sub Ordenar(a() As Double, ByVal lo As Long, ByVal hi As Long)
    Dim i As Long, j As Long, p As Double, t As Double
    i = lo: j = hi: p = a((lo + hi) \ 2)
    Do While i <= j
        Do While a(i) < p: i = i + 1: Loop
        Do While a(j) > p: j = j - 1: Loop
        If i <= j Then t = a(i): a(i) = a(j): a(j) = t: i = i + 1: j = j - 1
    Loop
    If lo < j Then Ordenar a, lo, j
    If i < hi Then Ordenar a, i, hi
End Sub

Private Function AcharTabela(wb As Workbook, nome As String) As ListObject
    Dim ws As Worksheet, lo As ListObject
    For Each ws In wb.Worksheets
        For Each lo In ws.ListObjects
            If lo.Name = nome Then Set AcharTabela = lo: Exit Function
        Next lo
    Next ws
End Function

Private Function TemTabela(wb As Workbook, nome As String) As Boolean
    TemTabela = Not AcharTabela(wb, nome) Is Nothing
End Function

Private Function TemAba(wb As Workbook, nome As String) As Boolean
    Dim ws As Object
    On Error Resume Next
    Set ws = wb.Sheets(nome)
    TemAba = Not ws Is Nothing
    On Error GoTo 0
End Function

Private Function ColunaDaTabela(lo As ListObject, nome As String) As Long
    Dim c As ListColumn
    For Each c In lo.ListColumns
        If Trim(c.Name) = Trim(nome) Then ColunaDaTabela = c.Index: Exit Function
    Next c
End Function

Private Function LinhasUsadas(lo As ListObject) As Long
    If lo.DataBodyRange Is Nothing Then Exit Function
    LinhasUsadas = lo.ListRows.Count
    If LinhasUsadas = 1 Then
        If Application.WorksheetFunction.CountA(lo.DataBodyRange) = 0 Then LinhasUsadas = 0
    End If
End Function

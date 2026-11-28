Attribute VB_Name = "NovaBaseClientes"
'==============================================================================
' Planilhas de clientes lendo a nova base (Proposta Base de Dados EH)
'
' PrepararSeriesProposta  (rode com a PROPOSTA ativa)
'   Cria a aba Series, calculada so com formulas a partir das tabelas
'   (tbl_Cotacoes e tbl_Indices): CDI com indice acumulado, IPCA/IGPM/Poupanca
'   com indice acumulado, PTAX, Ibovespa e S&P 500. Nada e digitado nela.
'   Tambem aponta as formulas do Resumo de Mercado para a aba Series.
'
' MigrarClienteNovaBase  (rode com a planilha do CLIENTE ativa; a base atual
'   e a Proposta abertas)
'   - Formulas que leem a base atual em colunas ANTES de 01/10/2026 (abas com
'     datas na linha 1, como COTA e COTA USD) viram valor.
'   - As demais passam a ler as tabelas da Proposta, por nomes definidos na
'     planilha do cliente:
'       EH_COTA(codigo; data)      ultima cota ate a data (tbl_Cotacoes)
'       EH_SERIE(codigo; data)     CDI, PTAX, IBOV, SP500 e indicadores globais
'       EH_EVENTO(codigo; data; amortizacao VERDADEIRO/FALSO)  (tbl_Eventos)
'       EH_INDICE(nome; data)      valor do mes da data (tbl_Indices)
'       EH_CDIIDX(data)            indice acumulado do CDI (aba Series)
'     e movimentacoes por SOMASES na tabela Movimentacoes.
'   - Troca o vinculo que sobrar (Resumo de Mercado) para a Proposta.
'   Nao salva.
'==============================================================================
Option Explicit

Private Const ABA_SERIES As String = "Series"

Private mVelho As String        ' nome do arquivo da base atual no vinculo (ex.: EH Base Unica.xlsx)
Private mVelha As Workbook      ' base atual aberta (para ler bancos e codigos)
Private mProp As Workbook
Private mCodZ As Object         ' Dados linha 2, colunas Z:AL -> codigo
Private mFalhas As Long

Private Function sCodigo() As String: sCodigo = "C" & ChrW(243) & "digo": End Function
Private Function sMes() As String: sMes = "M" & ChrW(234) & "s": End Function
Private Function sIndice() As String: sIndice = ChrW(205) & "ndice": End Function
Private Function sAmort() As String: sAmort = "Amortiza" & ChrW(231) & ChrW(227) & "o": End Function
Private Function NomeAbaMov() As String: NomeAbaMov = "Movimenta" & ChrW(231) & ChrW(245) & "es": End Function
Private Function DataCorte() As Date: DataCorte = DateSerial(2026, 10, 1): End Function

'==============================================================================
Public Sub PrepararSeriesProposta()
    Dim base As Workbook, ws As Worksheet, c As String, cod As String, idx As String, mes As String
    Set base = ActiveWorkbook
    If Not TemTabela(base, "tbl_Cotacoes") Or Not TemTabela(base, "tbl_Indices") Then
        MsgBox "Deixe a Proposta ativa (ela precisa ter tbl_Cotacoes e tbl_Indices).", vbExclamation
        Exit Sub
    End If
    If TemAba(base, ABA_SERIES) Then
        Set ws = base.Worksheets(ABA_SERIES)
        ws.Cells.Clear
    Else
        Set ws = base.Worksheets.Add(After:=base.Worksheets(base.Worksheets.Count))
        ws.Name = ABA_SERIES
    End If
    cod = "tbl_Cotacoes[" & sCodigo() & "]"
    mes = "tbl_Indices[" & sMes() & "]": idx = "tbl_Indices[" & sIndice() & "]"

    ws.Range("A1").Value = "Calculada das tabelas tbl_Cotacoes e tbl_Indices (nao digite aqui)"
    ws.Range("A2:C2").Value = Array("Data", "CDI (taxa anual)", "CDI indice")
    ws.Range("E2:K2").Value = Array(sMes(), "IPCA", "IPCA indice", "IGPM", "IGPM indice", "Poupanca", "Poupanca indice")
    ws.Range("M2:N2").Value = Array("Data", "PTAX")
    ws.Range("P2:Q2").Value = Array("Data", "IBOV")
    ws.Range("S2:T2").Value = Array("Data", "S&P 500")
    ws.Rows(2).Font.Bold = True

    ' CDI: indice base 1 no primeiro dia; I(t) = I(t-1) * (1 + taxa(t-1))^(1/252), como a base antiga
    ws.Range("A3").Formula2 = "=LET(k,(" & cod & "=""CDI"")*(tbl_Cotacoes[Subclasse]=""Dados""),d,FILTER(tbl_Cotacoes[Data],k)," & _
        "v,FILTER(tbl_Cotacoes[Valor],k),o,SORTBY(HSTACK(d,v),d,1),t,CHOOSECOLS(o,2)," & _
        "HSTACK(o,VSTACK(1,DROP(SCAN(1,t,LAMBDA(a,x,a*(1+x)^(1/252))),-1))))"
    ' Mensais: indices com a mesma base da aba Dados antiga (0,01 / 0,0001 / 0,00000001)
    ws.Range("E3").Formula2 = "=LET(m," & mes & ",i," & idx & ",v,tbl_Indices[Valor],k,(i=""IPCA"")+(i=""IGPM"")+(i=""POUPANCA"")," & _
        "u,SORT(UNIQUE(FILTER(m,k))),f,LAMBDA(n,SUMIFS(v,i,n,m,u)),ac,LAMBDA(b,x,SCAN(b,x,LAMBDA(p,y,p*(1+y))))," & _
        "aa,f(""IPCA""),gg,f(""IGPM""),pp,f(""POUPANCA""),HSTACK(u,aa,ac(0.01,aa),gg,ac(0.0001,gg),pp,ac(0.00000001,pp)))"
    ws.Range("M3").Formula2 = SerieFormula(cod, "PTAX")
    ws.Range("P3").Formula2 = SerieFormula(cod, "IBOV")
    ws.Range("S3").Formula2 = SerieFormula(cod, "SP500")
    ws.Range("A:A,E:E,M:M,P:P,S:S").NumberFormat = "dd/mm/yyyy"
    ws.Range("A1").NumberFormat = "General"
    ws.Columns("A:T").ColumnWidth = 12

    Dim n As Long
    If TemAba(base, "Resumo de Mercado") Then n = ApontarResumo(base.Worksheets("Resumo de Mercado"))
    Application.Calculate
    MsgBox "Aba Series criada." & vbCrLf & "Resumo de Mercado: " & n & " formulas agora leem a aba Series." & vbCrLf & _
           "A Proposta nao foi salva: confira e salve.", vbInformation, "Preparar series"
End Sub

Private Function SerieFormula(cod As String, codigo As String) As String
    SerieFormula = "=LET(k,(" & cod & "=""" & codigo & """)*(tbl_Cotacoes[Subclasse]=""Dados""),d,FILTER(tbl_Cotacoes[Data],k)," & _
                   "SORTBY(HSTACK(d,FILTER(tbl_Cotacoes[Valor],k)),d,1))"
End Function

Private Function ApontarResumo(ws As Worksheet) As Long
    Dim c As Range, f As String, g As String, fs As Range
    On Error Resume Next
    Set fs = ws.UsedRange.SpecialCells(xlCellTypeFormulas)
    On Error GoTo 0
    If fs Is Nothing Then Exit Function
    For Each c In fs.Cells
        f = c.Formula
        g = f
        g = Replace(g, "Dados!$M$3:$O$15000", "Series!$A$3:$C$30000")
        g = Replace(g, "Dados!$E$3:$K$2000", "Series!$E$3:$K$3000")
        g = Replace(g, "Dados!$Q$3:$R$15000", "Series!$M$3:$N$30000")
        g = Replace(g, "Dados!$T$3:$U$15000", "Series!$P$3:$Q$30000")
        g = Replace(g, "Dados!$W$3:$X$15000", "Series!$S$3:$T$30000")
        If g <> f Then c.Formula = g: ApontarResumo = ApontarResumo + 1
    Next c
End Function

'==============================================================================
Public Sub MigrarClienteNovaBase()
    Dim cli As Workbook, wb As Workbook, links As Variant, i As Long, linkVelho As String, nCand As Long
    Dim calcAntes As XlCalculation, ws As Worksheet, rel As String, resto As String
    Dim nCong As Long, nTroca As Long, nResto As Long

    Set cli = ActiveWorkbook
    Set mProp = Nothing: Set mVelha = Nothing
    For Each wb In Workbooks
        If TemTabela(wb, "tbl_Movimentacoes") And TemTabela(wb, "tbl_Cotacoes") Then Set mProp = wb
        If TemAba(wb, "Mapa") And TemAba(wb, "Fluxos") And Not TemTabela(wb, "tbl_Cotacoes") Then Set mVelha = wb
    Next wb
    If mProp Is Nothing Or mVelha Is Nothing Or cli Is mProp Or cli Is mVelha Then
        MsgBox "Deixe abertas a base atual (EH Base Unica) e a Proposta, e a planilha do cliente na frente.", _
               vbExclamation, "Migrar cliente"
        Exit Sub
    End If
    If Not TemAba(mProp, ABA_SERIES) Then
        MsgBox "A Proposta ainda nao tem a aba Series: rode PrepararSeriesProposta com ela na frente.", vbExclamation
        Exit Sub
    End If
    links = cli.LinkSources(xlExcelLinks)
    If IsEmpty(links) Then MsgBox "Esta planilha nao tem vinculos.", vbExclamation: Exit Sub
    For i = LBound(links) To UBound(links)
        If InStr(1, links(i), mVelha.Name, vbTextCompare) > 0 Then linkVelho = links(i)
    Next i
    If linkVelho = "" Then
        For i = LBound(links) To UBound(links)
            If InStr(1, links(i), "EH Base Unica", vbTextCompare) > 0 And InStr(1, links(i), mProp.Name, vbTextCompare) = 0 Then
                linkVelho = links(i): nCand = nCand + 1
            End If
        Next i
        If nCand > 1 Then linkVelho = ""
    End If
    If linkVelho = "" Then MsgBox "Nao achei o vinculo com a base atual.", vbExclamation: Exit Sub
    ' o vinculo pode ser caminho (C:\...\arquivo.xlsx) ou endereco do OneDrive (https://.../arquivo.xlsx)
    i = InStrRev(linkVelho, "\"): If InStrRev(linkVelho, "/") > i Then i = InStrRev(linkVelho, "/")
    mVelho = Mid(linkVelho, i + 1)
    If MsgBox("Planilha: " & cli.Name & vbCrLf & vbCrLf & _
              "- Antes de " & Format(DataCorte(), "dd/mm/yyyy") & ": formulas que leem " & mVelho & " viram valor." & vbCrLf & _
              "- Depois: passam a ler " & mProp.Name & "." & vbCrLf & vbCrLf & "Continuar?", _
              vbOKCancel + vbQuestion, "Migrar cliente") = vbCancel Then Exit Sub

    calcAntes = Application.Calculation
    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual
    On Error GoTo Falha
    CriarNomes cli
    LerCodigosZ
    mFalhas = 0

    For Each ws In cli.Worksheets
        Application.StatusBar = "Migrando " & ws.Name & "..."
        MigrarAba ws, nCong, nTroca, nResto, resto
    Next ws
    Application.StatusBar = False

    If nResto > 0 Then
        Application.Calculation = calcAntes
        Application.ScreenUpdating = True
        MsgBox "Congelei " & nCong & " e troquei " & nTroca & " formulas, mas " & nResto & _
               " ainda leem a base atual de um jeito que eu nao sei converter:" & vbCrLf & resto & vbCrLf & _
               "NAO troquei o vinculo. Feche SEM SALVAR e me mande este aviso.", vbExclamation, "Migrar cliente"
        Exit Sub
    End If
    cli.ChangeLink Name:=linkVelho, NewName:=mProp.FullName, Type:=xlExcelLinks
    Application.Calculation = calcAntes
    Application.Calculate
    Application.ScreenUpdating = True
    MsgBox "Formulas congeladas (antes de " & Format(DataCorte(), "dd/mm/yyyy") & "): " & Format(nCong, "#,##0") & vbCrLf & _
           "Formulas trocadas para a Proposta: " & Format(nTroca, "#,##0") & vbCrLf & _
           "Vinculo restante agora aponta para: " & mProp.Name & vbCrLf & vbCrLf & _
           "A planilha nao foi salva: confira a COTA e salve.", vbInformation, "Migrar cliente"
    Exit Sub
Falha:
    Application.StatusBar = False
    Application.Calculation = calcAntes
    Application.ScreenUpdating = True
    MsgBox "Erro: " & Err.Description & vbCrLf & "Feche a planilha SEM SALVAR.", vbCritical, "Migrar cliente"
End Sub

' Nomes da planilha do cliente que apontam para as tabelas da Proposta
Private Sub CriarNomes(cli As Workbook)
    Dim pc As String, pe As String, pi As String, pm As String, ps As String
    pc = "='[" & mProp.Name & "]Cotacoes'!"
    pe = "='[" & mProp.Name & "]Eventos'!"
    pi = "='[" & mProp.Name & "]Indices_Mensais'!"
    pm = "='[" & mProp.Name & "]" & NomeAbaMov() & "'!"
    ps = "='[" & mProp.Name & "]" & ABA_SERIES & "'!"
    DefinirNome cli, "EHc_Data", pc & "$A:$A"
    DefinirNome cli, "EHc_Cod", pc & "$B:$B"
    DefinirNome cli, "EHc_Sub", pc & "$C:$C"
    DefinirNome cli, "EHc_Valor", pc & "$D:$D"
    DefinirNome cli, "EHe_Cod", pe & "$A:$A"
    DefinirNome cli, "EHe_Data", pe & "$B:$B"
    DefinirNome cli, "EHe_Tipo", pe & "$C:$C"
    DefinirNome cli, "EHe_Valor", pe & "$D:$D"
    DefinirNome cli, "EHi_Mes", pi & "$A:$A"
    DefinirNome cli, "EHi_Nome", pi & "$B:$B"
    DefinirNome cli, "EHi_Valor", pi & "$C:$C"
    DefinirNome cli, "EHm_Data", pm & "$A:$A"
    DefinirNome cli, "EHm_Cliente", pm & "$C:$C"
    DefinirNome cli, "EHm_Banco", pm & "$E:$E"
    DefinirNome cli, "EHm_Cod", pm & "$F:$F"
    DefinirNome cli, "EHm_Valor", pm & "$I:$I"
    DefinirNome cli, "EHs_CdiData", ps & "$A$3:$A$30000"
    DefinirNome cli, "EHs_CdiIdx", ps & "$C$3:$C$30000"
    DefinirNome cli, "EH_COTA", "=LAMBDA(cod,dt,LET(d,MAXIFS(EHc_Data,EHc_Cod,TRIM(cod),EHc_Data,""<=""&dt,EHc_Sub,""<>Dados"")," & _
        "IF(d=0,0,SUMIFS(EHc_Valor,EHc_Cod,TRIM(cod),EHc_Data,d,EHc_Sub,""<>Dados""))))"
    DefinirNome cli, "EH_SERIE", "=LAMBDA(cod,dt,LET(d,MAXIFS(EHc_Data,EHc_Cod,TRIM(cod),EHc_Data,""<=""&dt,EHc_Sub,""Dados"")," & _
        "IF(d=0,0,SUMIFS(EHc_Valor,EHc_Cod,TRIM(cod),EHc_Data,d,EHc_Sub,""Dados""))))"
    DefinirNome cli, "EH_EVENTO", "=LAMBDA(cod,dt,amort,IF(amort,SUMIFS(EHe_Valor,EHe_Cod,TRIM(cod),EHe_Data,dt,EHe_Tipo,""" & sAmort() & """)," & _
        "SUMIFS(EHe_Valor,EHe_Cod,TRIM(cod),EHe_Data,dt,EHe_Tipo,""<>" & sAmort() & """)))"
    DefinirNome cli, "EH_INDICE", "=LAMBDA(nome,dt,SUMIFS(EHi_Valor,EHi_Nome,nome,EHi_Mes,DATE(YEAR(dt),MONTH(dt),1)))"
    DefinirNome cli, "EH_CDIIDX", "=LAMBDA(dt,XLOOKUP(dt,EHs_CdiData,EHs_CdiIdx,NA(),-1))"
End Sub

Private Sub DefinirNome(wb As Workbook, nome As String, refersTo As String)
    On Error Resume Next
    wb.Names(nome).Delete
    On Error GoTo 0
    wb.Names.Add Name:=nome, refersTo:=refersTo
End Sub

Private Sub LerCodigosZ()
    Dim ws As Worksheet, j As Long
    Set mCodZ = CreateObject("Scripting.Dictionary")
    If Not TemAba(mVelha, "Dados") Then Exit Sub
    Set ws = mVelha.Worksheets("Dados")
    For j = 27 To 38          ' AA:AL
        If Trim(CStr(ws.Cells(2, j).Value)) <> "" Then mCodZ(j) = Trim(CStr(ws.Cells(2, j).Value))
    Next j
End Sub

' Congela (antes do corte) ou reescreve cada formula da aba que le a base atual
Private Sub MigrarAba(ws As Worksheet, nCong As Long, nTroca As Long, nResto As Long, resto As String)
    Dim ur As Range, fs As Variant, vs As Variant, i As Long, j As Long, f As String, novo As String
    Dim colCorte As Long, c As Range, nr As Long, nc As Long, r0 As Long, c0 As Long
    Set ur = ws.UsedRange
    If Application.WorksheetFunction.CountA(ur) = 0 Then Exit Sub
    nr = ur.Rows.Count: nc = ur.Columns.Count: r0 = ur.Row: c0 = ur.Column
    If nr = 1 And nc = 1 Then
        ReDim fs(1 To 1, 1 To 1): ReDim vs(1 To 1, 1 To 1)
        fs(1, 1) = ur.Formula2: vs(1, 1) = ur.Value
    Else
        fs = ur.Formula2: vs = ur.Value
    End If
    colCorte = ColunaDeCorte(ws)     ' 0 = aba sem datas na linha 1 (nao congela)
    For i = 1 To nr
        For j = 1 To nc
            If VarType(fs(i, j)) = vbString Then
                f = fs(i, j)
                If Left(f, 1) = "=" Then
                    If InStr(1, f, "[" & mVelho & "]", vbTextCompare) > 0 Then
                        Set c = ws.Cells(r0 + i - 1, c0 + j - 1)
                        If colCorte > 0 And c.Column < colCorte Then
                            c.Value = vs(i, j)
                            nCong = nCong + 1
                        Else
                            novo = TrocarCalendario(Reescrever(f))
                            If novo <> f Then c.Formula2 = novo: nTroca = nTroca + 1
                            If AindaLeVelha(novo) Then
                                nResto = nResto + 1
                                If nResto <= 8 Then resto = resto & "  " & ws.Name & "!" & c.Address(0, 0) & ": " & Left(novo, 90) & vbCrLf
                            End If
                        End If
                    End If
                End If
            End If
        Next j
    Next i
End Sub

' Primeira coluna com data >= corte na linha 1 (so em abas com pelo menos 20 datas na linha 1)
Private Function ColunaDeCorte(ws As Worksheet) As Long
    Dim ult As Long, j As Long, n As Long, v As Variant, prim As Long
    ult = ws.Cells(1, ws.Columns.Count).End(xlToLeft).Column
    For j = 1 To ult
        v = ws.Cells(1, j).Value
        If VarType(v) = vbDate Then
            n = n + 1
            If prim = 0 And v >= DataCorte() Then prim = j
        End If
    Next j
    If n < 20 Then Exit Function
    If prim = 0 Then prim = ult + 1
    ColunaDeCorte = prim
End Function

' So o Resumo de Mercado pode continuar apontando para a base atual (o vinculo e trocado no fim)
Private Function AindaLeVelha(f As String) As Boolean
    Dim g As String
    g = Replace(f, "[" & mVelho & "]Resumo de Mercado'!", "", , , vbTextCompare)
    AindaLeVelha = (InStr(1, g, "[" & mVelho & "]", vbTextCompare) > 0)
End Function

Private Function TrocarCalendario(f As String) As String
    Dim re As Object
    Set re = CreateObject("VBScript.RegExp")
    re.Global = True: re.IgnoreCase = True
    re.Pattern = "('[^']*\[[^\]]+\]Dados'|\[[^\]]+\]Dados)!\$A\$(\d+):\$A\$(\d+)"
    TrocarCalendario = re.Replace(f, "'[" & mProp.Name & "]Calendario'!$A$$$2:$A$$$3")
End Function

'------------------------------------------------------------------------------
' Percorre a formula e troca VLOOKUP/HLOOKUP/XLOOKUP/SUMIFS que leem a base atual
Private Function Reescrever(f As String) As String
    Dim i As Long, n As Long, ch As String, out As String, j As Long, nm As String, fecha As Long
    Dim args As Variant, k As Long, rep As String
    n = Len(f): i = 1
    Do While i <= n
        ch = Mid(f, i, 1)
        If ch = """" Then
            j = FimAspas(f, i, """")
            out = out & Mid(f, i, j - i + 1): i = j + 1
        ElseIf ch = "'" Then
            j = FimAspas(f, i, "'")
            out = out & Mid(f, i, j - i + 1): i = j + 1
        ElseIf ch = "[" Then
            j = InStr(i, f, "]"): If j = 0 Then j = n
            out = out & Mid(f, i, j - i + 1): i = j + 1
        ElseIf ch Like "[A-Za-z_]" Then
            j = i
            Do While j <= n
                If Not (Mid(f, j, 1) Like "[A-Za-z0-9_.]") Then Exit Do
                j = j + 1
            Loop
            nm = Mid(f, i, j - i)
            If Mid(f, j, 1) = "(" And EhAlvo(nm) Then
                fecha = FechaParen(f, j)
                args = DividirArgs(Mid(f, j + 1, fecha - j - 1))
                For k = 0 To UBound(args): args(k) = Reescrever(CStr(args(k))): Next k
                rep = Transformar(UCase(Replace(nm, "_xlfn.", "", , , vbTextCompare)), args)
                If rep = "" Then rep = nm & "(" & Join(args, ",") & ")"
                out = out & rep
                i = fecha + 1
            Else
                out = out & nm: i = j
            End If
        Else
            out = out & ch: i = i + 1
        End If
    Loop
    Reescrever = out
End Function

Private Function EhAlvo(nm As String) As Boolean
    Select Case UCase(Replace(nm, "_xlfn.", "", , , vbTextCompare))
        Case "VLOOKUP", "HLOOKUP", "XLOOKUP", "SUMIFS": EhAlvo = True
    End Select
End Function

Private Function FimAspas(f As String, i As Long, q As String) As Long
    Dim j As Long
    j = i + 1
    Do While j <= Len(f)
        If Mid(f, j, 1) = q Then
            If Mid(f, j + 1, 1) = q Then
                j = j + 2
            Else
                FimAspas = j: Exit Function
            End If
        Else
            j = j + 1
        End If
    Loop
    FimAspas = Len(f)
End Function

Private Function FechaParen(f As String, abre As Long) As Long
    Dim j As Long, d As Long, ch As String
    j = abre
    Do While j <= Len(f)
        ch = Mid(f, j, 1)
        If ch = """" Or ch = "'" Then
            j = FimAspas(f, j, ch)
        ElseIf ch = "[" Then
            j = InStr(j, f, "]"): If j = 0 Then j = Len(f)
        ElseIf ch = "(" Then
            d = d + 1
        ElseIf ch = ")" Then
            d = d - 1
            If d = 0 Then FechaParen = j: Exit Function
        End If
        j = j + 1
    Loop
    FechaParen = Len(f)
End Function

Private Function DividirArgs(s As String) As Variant
    Dim res() As String, n As Long, j As Long, d As Long, ch As String, ini As Long
    ReDim res(0 To 0): ini = 1: j = 1
    Do While j <= Len(s)
        ch = Mid(s, j, 1)
        If ch = """" Or ch = "'" Then
            j = FimAspas(s, j, ch)
        ElseIf ch = "[" Then
            j = InStr(j, s, "]"): If j = 0 Then j = Len(s)
        ElseIf ch = "(" Or ch = "{" Then
            d = d + 1
        ElseIf ch = ")" Or ch = "}" Then
            d = d - 1
        ElseIf ch = "," And d = 0 Then
            ReDim Preserve res(0 To n): res(n) = Mid(s, ini, j - ini): n = n + 1: ini = j + 1
        End If
        j = j + 1
    Loop
    ReDim Preserve res(0 To n): res(n) = Mid(s, ini)
    DividirArgs = res
End Function

' Le "<livro>Aba!$X$1:$Y$9": devolve True se e da base atual, com o nome da aba e a 1a coluna
Private Function RefVelha(ByVal a As String, aba As String, col1 As String) As Boolean
    Dim p As Long, q As Long, rng As String, k As Long
    a = Trim(a)
    If InStr(1, a, "[" & mVelho & "]", vbTextCompare) = 0 Then Exit Function
    p = InStr(1, a, "]"): q = InStrRev(a, "!")
    If p = 0 Or q < p Then Exit Function
    aba = Mid(a, p + 1, q - p - 1)
    If Right(aba, 1) = "'" Then aba = Left(aba, Len(aba) - 1)
    rng = Replace(Mid(a, q + 1), "$", "")
    col1 = ""
    For k = 1 To Len(rng)
        If Mid(rng, k, 1) Like "[A-Za-z]" Then col1 = col1 & UCase(Mid(rng, k, 1)) Else Exit For
    Next k
    RefVelha = True
End Function

' "$E57" -> "$E55" (desloca linhas, mantendo os $)
Private Function Deslocar(ByVal r As String, dl As Long) As String
    Dim re As Object, m As Object
    Set re = CreateObject("VBScript.RegExp")
    re.Pattern = "^(\$?[A-Za-z]{1,3}\$?)(\d+)$"
    r = Trim(r)
    If Not re.Test(r) Then Exit Function
    Set m = re.Execute(r)(0)
    If CLng(m.SubMatches(1)) + dl < 1 Then Exit Function
    Deslocar = m.SubMatches(0) & CStr(CLng(m.SubMatches(1)) + dl)
End Function

Private Function Transformar(fn As String, args As Variant) As String
    Dim aba As String, col1 As String, aba2 As String, col2 As String, cod As String, n As Long, a0 As String
    Dim t As String, mais As Boolean, banco As String, mov As String
    If UBound(args) < 1 Then Exit Function
    a0 = Trim(CStr(args(0)))
    Select Case fn
    Case "VLOOKUP"
        If UBound(args) < 2 Then Exit Function
        If Not RefVelha(CStr(args(1)), aba, col1) Then Exit Function
        Select Case LCase(aba)
        Case "cotas", "cotas usd"
            cod = Deslocar(CStr(args(2)), -2)          ' linha "Ref plan Cotas" -> linha "Codigo"
            If cod <> "" Then Transformar = "EH_COTA(" & cod & "," & a0 & ")"
        Case "dados"
            If Not IsNumeric(Trim(CStr(args(2)))) Then Exit Function
            n = CLng(Trim(CStr(args(2))))
            Select Case col1
            Case "M"
                If n = 3 Then Transformar = "EH_CDIIDX(" & a0 & ")"
                If n = 2 Then Transformar = "EH_SERIE(""CDI""," & a0 & ")"
            Case "E"
                If n = 2 Then Transformar = "EH_INDICE(""IPCA""," & a0 & ")"
                If n = 4 Then Transformar = "EH_INDICE(""IGPM""," & a0 & ")"
                If n = 6 Then Transformar = "EH_INDICE(""POUPANCA""," & a0 & ")"
            Case "AN"
                If n = 2 Then Transformar = "EH_INDICE(""CPI""," & a0 & ")"
            Case "Q"
                If n = 2 Then Transformar = "EH_SERIE(""PTAX""," & a0 & ")"
            Case "T"
                If n = 2 Then Transformar = "EH_SERIE(""IBOV""," & a0 & ")"
            Case "W"
                If n = 2 Then Transformar = "EH_SERIE(""SP500""," & a0 & ")"
            Case "Z"
                If mCodZ.Exists(26 + n - 1) Then Transformar = "EH_SERIE(""" & mCodZ(26 + n - 1) & """," & a0 & ")"
            End Select
        End Select
    Case "HLOOKUP"
        If UBound(args) < 2 Then Exit Function
        If Not RefVelha(CStr(args(1)), aba, col1) Then Exit Function
        If LCase(aba) <> "fluxos" Or col1 <> "F" Then Exit Function
        t = Replace(Trim(CStr(args(2))), " ", "")
        If Right(t, 2) = "+1" Then mais = True: t = Left(t, Len(t) - 2)
        cod = Deslocar(t, -3)                          ' linha "Ref plan fluxo" -> linha "Codigo"
        If cod <> "" Then Transformar = "EH_EVENTO(" & cod & "," & a0 & "," & IIf(mais, "FALSE", "TRUE") & ")"
    Case "XLOOKUP"
        If UBound(args) < 2 Then Exit Function
        If Not RefVelha(CStr(args(1)), aba, col1) Then Exit Function
        If Not RefVelha(CStr(args(2)), aba2, col2) Then Exit Function
        If LCase(aba) <> "dados" Or col1 <> "Z" Then Exit Function
        n = Range(col2 & "1").Column
        If mCodZ.Exists(n) Then Transformar = "EH_SERIE(""" & mCodZ(n) & """," & a0 & ")"
    Case "SUMIFS"
        ' movimentacoes: SUMIFS(<aba>!$V:$V,<aba>!$C:$C,codigo,<aba>!$D:$D,data)
        If UBound(args) <> 4 Then Exit Function
        If Not RefVelha(CStr(args(0)), aba, col1) Then Exit Function
        If Not RefVelha(CStr(args(1)), aba2, col2) Then Exit Function
        banco = BancoDoBloco(aba, col2)
        If banco = "" Then Exit Function
        Transformar = "SUMIFS(EHm_Valor,EHm_Cliente,""" & aba & """,EHm_Banco,""" & banco & """,EHm_Cod," & _
                      Trim(CStr(args(2))) & ",EHm_Data," & Trim(CStr(args(4))) & ")"
    End Select
End Function

' Banco do bloco da aba antiga cuja coluna de codigo (CNPJ) e colLetra: titulo na linha 1 do bloco
Private Function BancoDoBloco(aba As String, colLetra As String) As String
    Dim ws As Worksheet, c0 As Long, j As Long, t As String
    If Not TemAba(mVelha, aba) Then Exit Function
    Set ws = mVelha.Worksheets(aba)
    c0 = ws.Range(colLetra & "1").Column
    For j = c0 To c0 + 6
        t = t & " " & UCase(CStr(ws.Cells(1, j).Value))
    Next j
    If InStr(t, "MONTE BRAVO") > 0 Then
        BancoDoBloco = "MONTE BRAVO"
    ElseIf InStr(t, "XP INVEST") > 0 Then
        BancoDoBloco = "XP"
    ElseIf InStr(t, "BTG") > 0 Then
        BancoDoBloco = "BTG"
    ElseIf InStr(t, "EQI") > 0 Then
        BancoDoBloco = "EQI"
    End If
End Function

'------------------------------------------------------------------------------
Private Function TemTabela(wb As Workbook, nome As String) As Boolean
    Dim ws As Worksheet, lo As ListObject
    For Each ws In wb.Worksheets
        For Each lo In ws.ListObjects
            If StrComp(lo.Name, nome, vbTextCompare) = 0 Then TemTabela = True: Exit Function
        Next lo
    Next ws
End Function

Private Function TemAba(wb As Workbook, nome As String) As Boolean
    Dim ws As Worksheet
    For Each ws In wb.Worksheets
        If StrComp(ws.Name, nome, vbTextCompare) = 0 Then TemAba = True: Exit Function
    Next ws
End Function
